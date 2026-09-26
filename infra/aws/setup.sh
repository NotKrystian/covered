#!/usr/bin/env bash
# One-time (idempotent) AWS plumbing for the Covered App Runner service.
# Called by scripts/deploy.sh; safe to re-run by hand.
#
#   ECR repo          covered-apprunner   (its own repo: the EC2 path in deploy/ pushes an arm64
#                                          `covered:latest`, and App Runner auto-deploys on `latest`)
#   IAM roles         covered-apprunner-ecr-access   (build.apprunner.amazonaws.com pulls the image)
#                     covered-apprunner-instance     (tasks.apprunner.amazonaws.com: S3 + DynamoDB + Bedrock)
#                     covered-codebuild              (remote `docker build` when there is no local Docker)
#   CodeBuild project covered-image                  (buildspec: infra/aws/codebuild/buildspec.yml)
#
# Policies live in infra/aws/iam/*.json. Everything is tagged Project=covered.
# Creds: default AWS credential chain. Nothing here reads or prints a secret.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export AWS_PAGER=""

REGION="${AWS_REGION:-eu-west-2}"
EXPECTED_ACCOUNT="616532055961"
ECR_REPO="${ECR_REPO:-covered-apprunner}"
S3_BUCKET="${S3_BUCKET:-covered-hack-616532055961}"
CODEBUILD_PROJECT="${CODEBUILD_PROJECT:-covered-image}"
ECR_ACCESS_ROLE="covered-apprunner-ecr-access"
INSTANCE_ROLE="covered-apprunner-instance"
CODEBUILD_ROLE="covered-codebuild"
TAGS_KV="Key=Project,Value=covered"

log() { printf '\033[1;34m[setup]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[setup] %s\033[0m\n' "$*" >&2; exit 1; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[[ "$ACCOUNT" == "$EXPECTED_ACCOUNT" ]] || die "wrong AWS account: $ACCOUNT (expected $EXPECTED_ACCOUNT)"

# ---- ECR ----------------------------------------------------------------------
if aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$REGION" >/dev/null 2>&1; then
  log "ecr repo exists: $ECR_REPO"
else
  log "creating ecr repo: $ECR_REPO"
  aws ecr create-repository --repository-name "$ECR_REPO" --region "$REGION" \
    --image-scanning-configuration scanOnPush=true \
    --image-tag-mutability MUTABLE \
    --tags "$TAGS_KV" >/dev/null
fi
# Keep only the last 10 images; App Runner deploys `latest`.
aws ecr put-lifecycle-policy --repository-name "$ECR_REPO" --region "$REGION" --lifecycle-policy-text '{
  "rules": [{"rulePriority": 1, "description": "keep last 10",
    "selection": {"tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 10},
    "action": {"type": "expire"}}]
}' >/dev/null

# ---- IAM helpers ------------------------------------------------------------------
# ensure_role <name> <trust-json> [<inline-policy-name> <policy-json>]
ensure_role() {
  local name="$1" trust="$2" pol_name="${3:-}" pol_file="${4:-}"
  if aws iam get-role --role-name "$name" >/dev/null 2>&1; then
    log "iam role exists: $name"
    aws iam update-assume-role-policy --role-name "$name" --policy-document "file://$trust"
  else
    log "creating iam role: $name"
    aws iam create-role --role-name "$name" \
      --assume-role-policy-document "file://$trust" \
      --description "Covered hackathon app ($name)" \
      --tags "$TAGS_KV" >/dev/null
    ROLE_CREATED=1
  fi
  if [[ -n "$pol_name" ]]; then
    aws iam put-role-policy --role-name "$name" --policy-name "$pol_name" \
      --policy-document "file://$pol_file"
  fi
}

ROLE_CREATED=0
ensure_role "$ECR_ACCESS_ROLE" "$HERE/iam/apprunner-ecr-access-trust.json"
aws iam attach-role-policy --role-name "$ECR_ACCESS_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess

ensure_role "$INSTANCE_ROLE" "$HERE/iam/apprunner-instance-trust.json" \
  "$INSTANCE_ROLE" "$HERE/iam/apprunner-instance-policy.json"

ensure_role "$CODEBUILD_ROLE" "$HERE/iam/codebuild-trust.json" \
  "$CODEBUILD_ROLE" "$HERE/iam/codebuild-policy.json"

if [[ "$ROLE_CREATED" == 1 ]]; then
  log "new IAM roles: waiting 10s for propagation"
  sleep 10
fi

# ---- CodeBuild (remote image build) ----------------------------------------------------
BUILDSPEC="$(cat "$HERE/codebuild/buildspec.yml")"
SOURCE_JSON="$(jq -cn --arg loc "$S3_BUCKET/build/source.zip" --arg spec "$BUILDSPEC" \
  '{type:"S3", location:$loc, buildspec:$spec}')"
ENV_JSON='{"type":"LINUX_CONTAINER","image":"aws/codebuild/amazonlinux-x86_64-standard:5.0","computeType":"BUILD_GENERAL1_MEDIUM","privilegedMode":true}'
CB_ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${CODEBUILD_ROLE}"

if aws codebuild batch-get-projects --names "$CODEBUILD_PROJECT" --region "$REGION" \
     --query 'projects[0].name' --output text 2>/dev/null | grep -qx "$CODEBUILD_PROJECT"; then
  log "codebuild project exists: $CODEBUILD_PROJECT (updating)"
  aws codebuild update-project --name "$CODEBUILD_PROJECT" --region "$REGION" \
    --source "$SOURCE_JSON" --artifacts type=NO_ARTIFACTS --environment "$ENV_JSON" \
    --service-role "$CB_ROLE_ARN" --timeout-in-minutes 30 >/dev/null
else
  log "creating codebuild project: $CODEBUILD_PROJECT"
  aws codebuild create-project --name "$CODEBUILD_PROJECT" --region "$REGION" \
    --description "Builds the Covered Docker image and pushes it to ECR" \
    --source "$SOURCE_JSON" --artifacts type=NO_ARTIFACTS --environment "$ENV_JSON" \
    --service-role "$CB_ROLE_ARN" --timeout-in-minutes 30 \
    --tags key=Project,value=covered >/dev/null
fi

log "done. ecr=${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO} roles=${ECR_ACCESS_ROLE},${INSTANCE_ROLE},${CODEBUILD_ROLE}"
