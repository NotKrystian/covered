#!/usr/bin/env bash
# Create the Covered receipts bucket. Idempotent: safe to re-run.
#
# Bucket:  covered-hack-616532055961 (new bucket only; never an existing Kawuc bucket)
# Region:  eu-west-2
# Creds:   default AWS credential chain (local `default` profile). Nothing is read from ~/.aws here.
#
# Usage: infra/aws/create-bucket.sh
set -euo pipefail

BUCKET="${S3_BUCKET:-covered-hack-616532055961}"
REGION="${AWS_REGION:-eu-west-2}"
EXPECTED_ACCOUNT="616532055961"

case "$BUCKET" in
  covered-hack-*) ;;
  *) echo "refusing to touch non-Covered bucket: $BUCKET" >&2; exit 1 ;;
esac

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$ACCOUNT" != "$EXPECTED_ACCOUNT" ]]; then
  echo "wrong AWS account: $ACCOUNT (expected $EXPECTED_ACCOUNT)" >&2
  exit 1
fi

if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1; then
  echo "bucket exists: $BUCKET"
else
  echo "creating bucket: $BUCKET in $REGION"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  aws s3api wait bucket-exists --bucket "$BUCKET" --region "$REGION"
fi

echo "blocking public access"
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "enabling versioning"
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --versioning-configuration Status=Enabled

echo "setting 30-day expiry lifecycle"
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "expire-after-30-days",
        "Status": "Enabled",
        "Filter": { "Prefix": "" },
        "Expiration": { "Days": 30 },
        "NoncurrentVersionExpiration": { "NoncurrentDays": 30 },
        "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
      }
    ]
  }'

echo "done: s3://$BUCKET ($REGION)"
