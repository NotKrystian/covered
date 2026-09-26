# Covered — AWS deploy configuration. Sourced by every script in deploy/aws/.
# No secrets here: the instance authenticates with its IAM role, nothing else.
# Override anything with an environment variable of the same name.

export AWS_REGION="${AWS_REGION:-eu-west-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""

export PROJECT="${PROJECT:-covered}"
export ACCOUNT_ID="${ACCOUNT_ID:-616532055961}"

# Receipts bucket (owned by Infra; we only grant the instance access to it).
export S3_BUCKET="${S3_BUCKET:-covered-hack-616532055961}"

# Bedrock model the container calls. The Decision agent reports the real ID;
# update this line and run deploy/aws/redeploy.sh — it re-reads this file.
export BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-eu.anthropic.claude-haiku-4-5-20251001-v1:0}"

# DynamoDB table used by src/lib/memory (created by the Judge+Memory agent, not here).
export MEMORY_TABLE="${MEMORY_TABLE:-covered-memory}"
# DynamoDB table for remote-reader jobs + pair-code index (src/lib/jobs/create-table.sh).
export JOBS_TABLE="${JOBS_TABLE:-covered-jobs}"

# Extra `-e KEY=VALUE` pairs for the container, space-separated (e.g. "COVERED_MOCK=1").
export EXTRA_CONTAINER_ENV="${EXTRA_CONTAINER_ENV:-}"

# Resource names (all tagged Project=covered).
export ECR_REPO="${ECR_REPO:-covered}"
export ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
export DEPLOY_BUCKET="${DEPLOY_BUCKET:-covered-deploy-${ACCOUNT_ID}}"   # source tarballs + SSM output
export ROLE_NAME="${ROLE_NAME:-covered-ec2}"
export PROFILE_NAME="${PROFILE_NAME:-covered-ec2}"
export SG_NAME="${SG_NAME:-covered-web}"
export INSTANCE_NAME="${INSTANCE_NAME:-covered-web}"
export INSTANCE_TYPE="${INSTANCE_TYPE:-t4g.medium}"
export VOLUME_GB="${VOLUME_GB:-20}"
export AMI_PARAM="/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"

export CONTAINER_NAME="covered"
export TAGS="Project=${PROJECT}"
