#!/usr/bin/env bash
# Create the `covered-jobs` DynamoDB table (on-demand, PK user_id, SK job_id, TTL `ttl`)
# in eu-west-2. Idempotent: exits 0 if the table already exists (and still makes sure
# TTL is on). Owned by the Reader/Extension agent. Default AWS credential chain; no secrets.
set -euo pipefail

TABLE="${COVERED_JOBS_TABLE:-covered-jobs}"
REGION="${BEDROCK_REGION:-${AWS_REGION:-eu-west-2}}"

ensure_ttl() {
  local status
  status=$(aws dynamodb describe-time-to-live --table-name "$TABLE" --region "$REGION" \
    --query 'TimeToLiveDescription.TimeToLiveStatus' --output text 2>/dev/null || echo DISABLED)
  case "$status" in
    ENABLED|ENABLING) echo "ttl on $TABLE.ttl is $status" ;;
    *)
      echo "enabling ttl on $TABLE.ttl"
      aws dynamodb update-time-to-live --table-name "$TABLE" --region "$REGION" \
        --time-to-live-specification "Enabled=true,AttributeName=ttl" >/dev/null
      ;;
  esac
}

if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "table $TABLE already exists in $REGION"
  ensure_ttl
  exit 0
fi

echo "creating $TABLE in $REGION (PAY_PER_REQUEST, PK user_id, SK job_id)"
aws dynamodb create-table \
  --table-name "$TABLE" \
  --region "$REGION" \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=user_id,AttributeType=S AttributeName=job_id,AttributeType=S \
  --key-schema AttributeName=user_id,KeyType=HASH AttributeName=job_id,KeyType=RANGE \
  --tags Key=project,Value=covered \
  >/dev/null

aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
echo "table $TABLE is ACTIVE"
ensure_ttl
