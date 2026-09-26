#!/usr/bin/env bash
# Terminate TLS on the covered-web instance: nginx listens on :443 and proxies
# to the existing Next container on :80. Does not move or break the :80 mapping.
#
# Cert preference (never prints key material):
#   1. Cloudflare Origin CA (15y) via POST /certificates — needs SSL:Edit
#   2. Let's Encrypt via DNS-01 — needs Zone DNS:Edit (this token has it)
#   3. Self-signed on the instance — works for Cloudflare Full, 526 on Full (strict)
#
# Zone SSL mode is never changed. Other kawuc.uk hostnames keep the zone default.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
require aws jq openssl curl tar

HOST="covered.kawuc.uk"
CF_ENV="${COVERED_CF_ENV:-$HOME/.config/covered/cloudflare.env}"

INSTANCE_ID=$(find_instance)
[ -n "$INSTANCE_ID" ] || die "no ${INSTANCE_NAME} instance; run deploy/aws/up.sh first"
[ "$(instance_state "$INSTANCE_ID")" = "running" ] || die "instance ${INSTANCE_ID} is $(instance_state "$INSTANCE_ID")"

VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | sed 's/^None$//')
[ -n "$SG_ID" ] || die "security group ${SG_NAME} not found"
ensure_https_sg "$SG_ID"

CERT_KIND="self-signed"
WORK=$(mktemp -d -t covered-tls.XXXXXX)
chmod 700 "$WORK"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# Load Cloudflare creds into the environment without printing them.
if [ -f "$CF_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$CF_ENV"
  set +a
fi

# ---- 1. Origin CA -----------------------------------------------------------
try_origin_ca() {
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || return 1
  openssl req -new -newkey rsa:2048 -nodes \
    -keyout "$WORK/covered.key" \
    -out "$WORK/covered.csr" \
    -subj "/CN=${HOST}" \
    -addext "subjectAltName=DNS:${HOST}" >/dev/null 2>&1
  python3 - "$WORK" "$HOST" <<'PY'
import json, os, sys, urllib.request
work, host = sys.argv[1], sys.argv[2]
token = os.environ["CLOUDFLARE_API_TOKEN"]
csr = open(os.path.join(work, "covered.csr")).read()
body = json.dumps({
    "hostnames": [host],
    "requested_validity": 5475,
    "request_type": "origin-rsa",
    "csr": csr,
}).encode()
req = urllib.request.Request(
    "https://api.cloudflare.com/client/v4/certificates",
    data=body,
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw, status = resp.read(), resp.status
except urllib.error.HTTPError as e:
    raw, status = e.read(), e.code
d = json.loads(raw.decode())
err = (d.get("errors") or [{}])[0]
cert = (d.get("result") or {}).get("certificate") or ""
print("origin_ca_http", status)
print("origin_ca_ok", bool(d.get("success") and cert))
print("origin_ca_err", err.get("code"), err.get("message"))
if cert:
    open(os.path.join(work, "covered.crt"), "w").write(cert)
    raise SystemExit(0)
raise SystemExit(1)
PY
}

# ---- 2. Let's Encrypt DNS-01 (acme.sh, isolated --home) ---------------------
try_letsencrypt() {
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] || return 1
  local src="$WORK/acme.sh-src" home="$WORK/acme-home" out="$WORK/le"
  mkdir -p "$src" "$home" "$out"
  chmod 700 "$home" "$out"
  curl -sSfL "https://github.com/acmesh-official/acme.sh/archive/refs/heads/master.tar.gz" \
    | tar -xz -C "$src" --strip-components=1
  # dns_cf reads CF_Token / CF_Zone_ID. Account.conf lives in $home (deleted).
  CF_Token="${CLOUDFLARE_API_TOKEN}" \
  CF_Zone_ID="${CLOUDFLARE_ZONE_ID:-}" \
  "$src/acme.sh" --home "$home" --issue --dns dns_cf -d "$HOST" \
    --server letsencrypt --dnssleep 25 \
    --keylength 2048 \
    >/tmp/covered-acme.log 2>&1 || {
      log "Let's Encrypt failed (see /tmp/covered-acme.log, no secrets should be in it)"
      # Strip any accidental PEM from the summary we print.
      grep -v -- '-----BEGIN' /tmp/covered-acme.log | tail -n 30 >&2 || true
      return 1
    }
  "$src/acme.sh" --home "$home" --install-cert -d "$HOST" \
    --key-file "$out/covered.key" \
    --fullchain-file "$out/covered.crt" \
    >/dev/null 2>&1
  [ -s "$out/covered.key" ] && [ -s "$out/covered.crt" ] || return 1
  cp "$out/covered.key" "$WORK/covered.key"
  cp "$out/covered.crt" "$WORK/covered.crt"
  chmod 600 "$WORK/covered.key"
}

if try_origin_ca; then
  CERT_KIND="origin-ca"
  log "using Cloudflare Origin CA for ${HOST}"
elif try_letsencrypt; then
  CERT_KIND="letsencrypt"
  log "using Let's Encrypt for ${HOST}"
else
  log "no public/origin cert; instance will mint self-signed (526 if zone is Full strict)"
  rm -f "$WORK/covered.key" "$WORK/covered.crt"
fi

# Push a laptop-issued cert via the deploy bucket; never echo the key.
REMOTE_CERT_SRC="self-signed"
if [ -s "$WORK/covered.key" ] && [ -s "$WORK/covered.crt" ]; then
  S3_PREFIX="tls/${INSTANCE_ID}/$(date -u +%Y%m%dT%H%M%SZ)"
  aws s3 cp --only-show-errors --sse AES256 "$WORK/covered.crt" "s3://${DEPLOY_BUCKET}/${S3_PREFIX}/covered.crt"
  aws s3 cp --only-show-errors --sse AES256 "$WORK/covered.key" "s3://${DEPLOY_BUCKET}/${S3_PREFIX}/covered.key"
  REMOTE_CERT_SRC="s3://${DEPLOY_BUCKET}/${S3_PREFIX}"
  openssl x509 -in "$WORK/covered.crt" -noout -subject -dates -issuer >&2
fi

log "installing nginx + ${CERT_KIND} cert on ${INSTANCE_ID}"
run_ssm "$INSTANCE_ID" 300 "covered tls nginx ${CERT_KIND}" <<EOF
set -euo pipefail
umask 077
dnf install -y nginx >/tmp/covered-nginx-dnf.log
mkdir -p /opt/covered/tls
REMOTE_CERT_SRC="${REMOTE_CERT_SRC}"
if [ "\$REMOTE_CERT_SRC" != "self-signed" ]; then
  aws s3 cp --only-show-errors "\${REMOTE_CERT_SRC}/covered.crt" /opt/covered/tls/covered.crt
  aws s3 cp --only-show-errors "\${REMOTE_CERT_SRC}/covered.key" /opt/covered/tls/covered.key
  echo "installed cert from deploy bucket (${CERT_KIND})"
elif [ ! -s /opt/covered/tls/covered.key ] || [ ! -s /opt/covered/tls/covered.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \\
    -keyout /opt/covered/tls/covered.key \\
    -out /opt/covered/tls/covered.crt \\
    -subj "/CN=${HOST}" \\
    -addext "subjectAltName=DNS:${HOST}" >/tmp/covered-openssl.log 2>&1
  echo "issued self-signed cert for ${HOST}"
else
  echo "existing self-signed cert left in place"
fi
chmod 600 /opt/covered/tls/covered.key
chmod 644 /opt/covered/tls/covered.crt
chown root:root /opt/covered/tls/covered.key /opt/covered/tls/covered.crt
openssl x509 -in /opt/covered/tls/covered.crt -noout -subject -dates -issuer

cat >/etc/nginx/nginx.conf <<'NGINX'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;
include /usr/share/nginx/modules/*.conf;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  types_hash_max_size 4096;
  sendfile on;
  keepalive_timeout 65;
  client_max_body_size 8m;
  server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name covered.kawuc.uk;
    ssl_certificate /opt/covered/tls/covered.crt;
    ssl_certificate_key /opt/covered/tls/covered.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    location / {
      proxy_pass http://127.0.0.1:80;
      proxy_http_version 1.1;
      proxy_set_header Host \$host;
      proxy_set_header X-Real-IP \$remote_addr;
      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto https;
      proxy_read_timeout 120s;
    }
  }
}
NGINX
nginx -t
systemctl enable --now nginx
systemctl reload nginx
echo "== listeners"
ss -lnt | awk 'NR==1 || /:80 / || /:443 /'
echo "== nginx"
systemctl is-active nginx
echo "== local 443"
curl -sk -o /dev/null -m 10 -w 'local_https %{http_code}\\n' https://127.0.0.1/ -H 'Host: covered.kawuc.uk'
curl -s -o /dev/null -m 10 -w 'local_http %{http_code}\\n' http://127.0.0.1/
EOF

if [ "$REMOTE_CERT_SRC" != "self-signed" ]; then
  aws s3 rm --only-show-errors --recursive "s3://${DEPLOY_BUCKET}/${S3_PREFIX}/" || true
fi

log "cert kind: ${CERT_KIND}"
