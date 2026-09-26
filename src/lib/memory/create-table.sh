#!/usr/bin/env bash
# Create the `covered-memory` DynamoDB table (on-demand, PK user_id) in eu-west-2.
# Idempotent: exits 0 if the table already exists. Owned by Judge+Memory.
# Uses the default AWS credential chain; nothing secret lives here.
set -euo pipefail

TABLE="${COVERED_MEMORY_TABLE:-covered-memory}"
REGION="${BEDROCK_REGION:-${AWS_REGION:-eu-west-2}}"

if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "table $TABLE already exists in $REGION"
  exit 0
fi

echo "creating $TABLE in $REGION (PAY_PER_REQUEST, PK user_id)"
aws dynamodb create-table \
  --table-name "$TABLE" \
  --region "$REGION" \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions AttributeName=user_id,AttributeType=S \
  --key-schema AttributeName=user_id,KeyType=HASH \
  --tags Key=project,Value=covered \
  >/dev/null

aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
echo "table $TABLE is ACTIVE"
