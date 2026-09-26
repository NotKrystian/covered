#!/usr/bin/env bash
# Ship the current working tree: build the arm64 image, push to ECR, restart the
# container on the instance. Run this after every code change.
#
#   deploy/aws/redeploy.sh                  # ships the working tree
#   DEPLOY_REF=HEAD deploy/aws/redeploy.sh  # ships a committed ref instead
#
# Where the build happens:
#   - Docker on this machine  -> `docker buildx build --platform linux/arm64 --push`
#   - no Docker (default Mac) -> tar the source (tracked + untracked, gitignored
#     files excluded, so no .env*), upload to the deploy bucket, and build natively
#     on the Graviton box via SSM. Docker layer cache on the box makes repeats fast.
# Either way the box then pulls :latest from ECR and restarts. The container env
# (/opt/covered/env) is rewritten from deploy/aws/env.sh on every run.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
require aws jq git tar

INSTANCE_ID=$(find_instance)
[ -n "$INSTANCE_ID" ] || die "no ${INSTANCE_NAME} instance; run deploy/aws/up.sh first"
[ "$(instance_state "$INSTANCE_ID")" = "running" ] || die "instance ${INSTANCE_ID} is $(instance_state "$INSTANCE_ID")"

cd "$ROOT"
DEPLOY_REF="${DEPLOY_REF:-}"
if [ -n "$DEPLOY_REF" ]; then
  SHA=$(git rev-parse --short "$DEPLOY_REF")
else
  SHA=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
  { git diff --quiet HEAD && [ -z "$(git ls-files --others --exclude-standard)" ]; } 2>/dev/null || SHA="${SHA}-dirty"
fi
TAG="${SHA}-$(date -u +%Y%m%dT%H%M%SZ)"
log "image tag ${TAG}"

# The env file the container reads. Rewritten every deploy from env.sh.
ENV_FILE_CONTENT=$(printf 'AWS_REGION=%s\nS3_BUCKET=%s\nBEDROCK_MODEL_ID=%s\nCOVERED_MEMORY_TABLE=%s\n' \
  "$AWS_REGION" "$S3_BUCKET" "$BEDROCK_MODEL_ID" "$MEMORY_TABLE")
for kv in ${EXTRA_CONTAINER_ENV}; do ENV_FILE_CONTENT+=$'\n'"$kv"; done

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  # ---- build here -----------------------------------------------------------
  log "building locally with buildx (linux/arm64) and pushing to ${ECR_URI}"
  aws ecr get-login-password | docker login --username AWS --password-stdin "${ECR_URI%%/*}" >/dev/null
  if [ -n "$DEPLOY_REF" ]; then
    CTX=$(mktemp -d -t covered-ctx.XXXXXX); trap 'rm -rf "$CTX"' EXIT
    git archive "$DEPLOY_REF" | tar -x -C "$CTX"
  else
    CTX=.
  fi
  docker buildx build --platform linux/arm64 --provenance=false \
    -t "${ECR_URI}:${TAG}" -t "${ECR_URI}:latest" --push "$CTX"
  BUILD_REMOTE=""
else
  # ---- build on the box -----------------------------------------------------
  log "no local Docker: shipping source to the instance to build there"
  TARBALL=$(mktemp -t covered-src.XXXXXX)
  trap 'rm -f "$TARBALL"' EXIT
  if [ -n "$DEPLOY_REF" ]; then
    git archive --format=tar.gz -o "$TARBALL" "$DEPLOY_REF"
  else
    # tracked + untracked-but-not-ignored, existing files only (drops deleted paths).
    git ls-files -z --cached --others --exclude-standard \
      | while IFS= read -r -d '' f; do [ -e "$f" ] && printf '%s\0' "$f"; done \
      | tar -czf "$TARBALL" --null -T -
  fi
  SRC_KEY="src/${TAG}.tar.gz"
  aws s3 cp --only-show-errors "$TARBALL" "s3://${DEPLOY_BUCKET}/${SRC_KEY}"
  log "uploaded $(du -h "$TARBALL" | cut -f1) to s3://${DEPLOY_BUCKET}/${SRC_KEY}"

  BUILD_REMOTE=$(cat <<EOF
mkdir -p /opt/covered/src && find /opt/covered/src -mindepth 1 -delete
aws s3 cp --only-show-errors "s3://${DEPLOY_BUCKET}/${SRC_KEY}" /tmp/covered-src.tgz
tar -xzf /tmp/covered-src.tgz -C /opt/covered/src && rm -f /tmp/covered-src.tgz
cd /opt/covered/src
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin "${ECR_URI%%/*}" >/dev/null
echo "== docker build ${TAG} (log: /opt/covered/build.log)"
if ! DOCKER_BUILDKIT=1 docker build --progress=plain -t "${ECR_URI}:${TAG}" -t "${ECR_URI}:latest" . >/opt/covered/build.log 2>&1; then
  echo "== BUILD FAILED, last 80 lines:"; tail -n 80 /opt/covered/build.log; exit 1
fi
tail -n 5 /opt/covered/build.log
docker push --quiet "${ECR_URI}:${TAG}"
docker push --quiet "${ECR_URI}:latest"
EOF
)
fi

run_ssm "$INSTANCE_ID" 1800 "covered redeploy ${TAG}" <<EOF
set -euo pipefail
${BUILD_REMOTE}
cat >/opt/covered/env <<'ENV'
${ENV_FILE_CONTENT}
ENV
echo "== restarting container"
/opt/covered/run.sh
sleep 3
docker ps --filter name=${CONTAINER_NAME} --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
EOF

IP=$(instance_ip "$INSTANCE_ID")
log "waiting for http://${IP}/ to answer"
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://${IP}/" || true)
  if [ "$code" = "200" ]; then
    log "deployed ${ECR_URI}:${TAG} -> http://${IP}/ (200)"
    exit 0
  fi
  sleep 3
done
die "http://${IP}/ did not return 200 (last: ${code:-none}); try deploy/aws/status.sh"
