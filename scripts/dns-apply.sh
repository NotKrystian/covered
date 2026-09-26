#!/usr/bin/env bash
# Point covered.kawuc.uk at the App Runner service via Cloudflare DNS.
#
# Reads the App Runner custom-domain association for `covered` (target hostname +
# ACM certificate validation records) and upserts, in the kawuc.uk zone:
#   CNAME covered            -> <service>.awsapprunner.com   (DNS only, NOT proxied)
#   CNAME _xxx.covered       -> _yyy.acm-validations.aws    (one per validation record)
# App Runner terminates TLS itself and validates the domain over a direct CNAME,
# so the records must stay grey-cloud (proxied=false).
#
# Creds: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID from ~/.config/covered/cloudflare.env
# (never in the repo). The token needs Zone:DNS:Edit on kawuc.uk. Idempotent:
# existing records are PUT, missing ones POSTed. Nothing secret is printed.
#
#   scripts/dns-apply.sh                # associate (if needed) + apply
#   scripts/dns-apply.sh --print        # only print the records, touch nothing in Cloudflare
set -euo pipefail

export AWS_PAGER=""
REGION="${AWS_REGION:-eu-west-2}"
SERVICE="${APPRUNNER_SERVICE:-covered}"
DOMAIN="${COVERED_DOMAIN:-covered.kawuc.uk}"
ENV_FILE="${COVERED_CF_ENV:-$HOME/.config/covered/cloudflare.env}"
PRINT_ONLY=0
[[ "${1:-}" == "--print" ]] && PRINT_ONLY=1

log() { printf '\033[1;34m[dns]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[dns] %s\033[0m\n' "$*" >&2; exit 1; }
for bin in aws jq curl; do command -v "$bin" >/dev/null 2>&1 || die "missing dependency: $bin"; done

# ---- App Runner side ------------------------------------------------------------------
ARN="$(aws apprunner list-services --region "$REGION" \
  --query "ServiceSummaryList[?ServiceName=='${SERVICE}'].ServiceArn | [0]" --output text | sed 's/^None$//')"
[[ -n "$ARN" ]] || die "App Runner service '$SERVICE' not found in $REGION (run scripts/deploy.sh first)"

DESC="$(aws apprunner describe-custom-domains --service-arn "$ARN" --region "$REGION" --output json)"
TARGET="$(jq -r '.DNSTarget' <<<"$DESC")"
if ! jq -e --arg d "$DOMAIN" '.CustomDomains[] | select(.DomainName==$d)' <<<"$DESC" >/dev/null; then
  log "associating $DOMAIN with $SERVICE (www disabled)"
  aws apprunner associate-custom-domain --service-arn "$ARN" --region "$REGION" \
    --domain-name "$DOMAIN" --no-enable-www-subdomain >/dev/null
  # Validation records take a few seconds to appear.
  for _ in $(seq 1 12); do
    DESC="$(aws apprunner describe-custom-domains --service-arn "$ARN" --region "$REGION" --output json)"
    n="$(jq -r --arg d "$DOMAIN" '[.CustomDomains[] | select(.DomainName==$d) | .CertificateValidationRecords[]?] | length' <<<"$DESC")"
    [[ "$n" -gt 0 ]] && break
    sleep 5
  done
fi
STATUS="$(jq -r --arg d "$DOMAIN" '.CustomDomains[] | select(.DomainName==$d) | .Status' <<<"$DESC")"

# records: TSV of name<TAB>value (all CNAME). Cloudflare wants names without the trailing dot.
RECORDS="$(jq -r --arg d "$DOMAIN" --arg t "$TARGET" '
  [ [$d, $t] ] + [ .CustomDomains[] | select(.DomainName==$d) | .CertificateValidationRecords[]? | [.Name, .Value] ]
  | .[] | map(sub("\\.$"; "")) | @tsv' <<<"$DESC")"

print_table() {
  echo
  echo "| Type  | Name | Target | Proxy |"
  echo "| ----- | ---- | ------ | ----- |"
  while IFS=$'\t' read -r name value; do
    [[ -n "$name" ]] && echo "| CNAME | \`$name\` | \`$value\` | DNS only |"
  done <<<"$RECORDS"
  echo
  echo "custom domain status: $STATUS"
}

if [[ "$PRINT_ONLY" == 1 ]]; then print_table; exit 0; fi

# ---- Cloudflare side --------------------------------------------------------------------
[[ -f "$ENV_FILE" ]] || { print_table; die "no $ENV_FILE; add the records above by hand"; }
set -a; . "$ENV_FILE"; set +a
[[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ZONE_ID:-}" ]] \
  || { print_table; die "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID missing in $ENV_FILE"; }

CF="https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records"
cf() { curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H 'Content-Type: application/json' "$@"; }

# Fail early and loudly (without leaking anything) if the token cannot touch DNS.
probe="$(cf "${CF}?per_page=1")"
if ! jq -e '.success' <<<"$probe" >/dev/null 2>&1; then
  print_table
  die "Cloudflare rejected the token for DNS on this zone ($(jq -r '.errors[0].message // "unknown error"' <<<"$probe")). Needs Zone:DNS:Edit on kawuc.uk. Add the records above by hand."
fi

upsert() {
  local name="$1" value="$2" body existing id resp
  body="$(jq -cn --arg n "$name" --arg v "$value" '{type:"CNAME", name:$n, content:$v, ttl:1, proxied:false}')"
  existing="$(cf "${CF}?type=CNAME&name=${name}")"
  id="$(jq -r '.result[0].id // empty' <<<"$existing")"
  if [[ -n "$id" ]]; then
    resp="$(cf -X PUT "${CF}/${id}" --data "$body")"
    log "updated CNAME $name -> $value"
  else
    resp="$(cf -X POST "$CF" --data "$body")"
    log "created CNAME $name -> $value"
  fi
  jq -e '.success' <<<"$resp" >/dev/null \
    || die "Cloudflare error for $name: $(jq -r '[.errors[].message] | join("; ")' <<<"$resp")"
}

while IFS=$'\t' read -r name value; do
  [[ -n "$name" ]] && upsert "$name" "$value"
done <<<"$RECORDS"

print_table
log "done. App Runner validates the certificate once the CNAMEs resolve (usually minutes; status -> ACTIVE)."
