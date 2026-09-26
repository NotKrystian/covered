#!/usr/bin/env bash
# Instance state, public IP, HTTP status, last 30 container log lines (via SSM).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
require aws jq curl

INSTANCE_ID=$(find_instance)
[ -n "$INSTANCE_ID" ] || die "no ${INSTANCE_NAME} instance found (run deploy/aws/up.sh)"
STATE=$(instance_state "$INSTANCE_ID")
IP=$(instance_ip "$INSTANCE_ID")

echo "instance:  ${INSTANCE_ID} (${INSTANCE_TYPE}, ${AWS_REGION})"
echo "state:     ${STATE}"
echo "public ip: ${IP:-<none>}"
echo "image:     ${ECR_URI}:latest"
echo "ssm:       aws ssm start-session --target ${INSTANCE_ID}"

if [ -n "$IP" ]; then
  echo
  echo "== curl -sI http://${IP}/"
  curl -sI -m 10 "http://${IP}/" | head -n 12 || echo "(no answer)"
  echo
  echo "== curl -sI https://covered.kawuc.uk/"
  curl -sI -m 15 "https://covered.kawuc.uk/" | head -n 12 || echo "(no answer)"
fi

if [ "$STATE" = "running" ]; then
  echo
  echo "== container (last 30 log lines)"
  run_ssm "$INSTANCE_ID" 60 "covered status" <<EOF
docker ps -a --filter name=${CONTAINER_NAME} --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
echo
docker logs --tail 30 ${CONTAINER_NAME} 2>&1 || echo "(container not found)"
EOF
fi
