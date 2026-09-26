#!/usr/bin/env bash
# App Runner path retired; live host is EC2 3.8.77.227 / covered.kawuc.uk
# Deploy Covered to AWS App Runner (eu-west-2): build image -> push to ECR ->
# create-or-update the `covered` service -> wait -> print the URL.
#
#   scripts/deploy.sh                          # BEDROCK_MODEL_ID from env (may be empty)
#   scripts/deploy.sh eu.anthropic.claude-sonnet-4-6
#   BEDROCK_MODEL_ID=... scripts/deploy.sh
#
# Image build: local `docker buildx` when a Docker daemon is available, otherwise
# the tree is zipped to s3://covered-hack-616532055961/build/ and the CodeBuild
# project `covered-image` runs the same Dockerfile (linux/amd64) and pushes it.
# Plumbing (ECR repo, IAM roles, CodeBuild project) is infra/aws/setup.sh.
# Creds: default AWS credential chain. Nothing secret is read or printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export AWS_PAGER=""

REGION="${AWS_REGION:-eu-west-2}"
ECR_REPO="${ECR_REPO:-covered-apprunner}"
SERVICE="${APPRUNNER_SERVICE:-covered}"
S3_BUCKET="${S3_BUCKET:-covered-hack-616532055961}"
MEMORY_TABLE="${MEMORY_TABLE:-covered-memory}"
BEDROCK_REGION="${BEDROCK_REGION:-$REGION}"
BEDROCK_MODEL_ID="${1:-${BEDROCK_MODEL_ID:-}}"
CODEBUILD_PROJECT="${CODEBUILD_PROJECT:-covered-image}"
SKIP_BUILD="${SKIP_BUILD:-0}"
# Browser-less runtime stage: App Runner runs with COVERED_READER_DISABLED=1, so
# the Dockerfile's default Playwright runtime image (for the EC2 path) is not wanted here.
RUNTIME_IMAGE="${RUNTIME_IMAGE:-node:22-slim}"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

for bin in aws jq git zip curl; do
  command -v "$bin" >/dev/null 2>&1 || die "missing dependency: $bin"
done

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ECR_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"
SHA="$(git rev-parse --short HEAD)"
IMAGE_TAG="$SHA"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  IMAGE_TAG="${SHA}-dirty-$(date +%Y%m%d%H%M%S)"
fi

log "region=$REGION account=$ACCOUNT image=${ECR_URI}:${IMAGE_TAG}"
"$ROOT/infra/aws/setup.sh"

# ---- build + push -------------------------------------------------------------
build_local() {
  log "docker daemon found: building linux/amd64 locally"
  aws ecr get-login-password --region "$REGION" \
    | docker login --username AWS --password-stdin "${ECR_URI%%/*}" >/dev/null
  docker buildx build --platform linux/amd64 --build-arg "RUNTIME_IMAGE=${RUNTIME_IMAGE}" \
    -t "${ECR_URI}:${IMAGE_TAG}" -t "${ECR_URI}:latest" --push .
}

build_remote() {
  log "no docker daemon: building with CodeBuild project $CODEBUILD_PROJECT"
  local zip key
  zip="$(mktemp -t covered-src.XXXXXX).zip"
  key="build/source-${IMAGE_TAG}.zip"
  # Same exclusions as .dockerignore; the zip IS the docker build context.
  zip -q -r "$zip" . \
    -x 'node_modules/*' '.next/*' '.git/*' '.env' '.env.*' '*.env' \
       'playwright-report/*' 'test-results/*' 'tsconfig.tsbuildinfo' 'next-env.d.ts' \
       'deploy/*' 'infra/*' 'scripts/*' '.cursor/*' '*.DS_Store' 'README.md'
  aws s3 cp "$zip" "s3://${S3_BUCKET}/${key}" --region "$REGION" --only-show-errors
  rm -f "$zip"

  local build_id status
  build_id="$(aws codebuild start-build --project-name "$CODEBUILD_PROJECT" --region "$REGION" \
    --source-location-override "${S3_BUCKET}/${key}" \
    --environment-variables-override \
      "name=ECR_URI,value=${ECR_URI},type=PLAINTEXT" \
      "name=IMAGE_TAG,value=${IMAGE_TAG},type=PLAINTEXT" \
      "name=RUNTIME_IMAGE,value=${RUNTIME_IMAGE},type=PLAINTEXT" \
    --query 'build.id' --output text)"
  log "codebuild $build_id started (logs: CloudWatch /aws/codebuild/${CODEBUILD_PROJECT})"
  while :; do
    status="$(aws codebuild batch-get-builds --ids "$build_id" --region "$REGION" \
      --query 'builds[0].buildStatus' --output text)"
    case "$status" in
      IN_PROGRESS) sleep 15 ;;
      SUCCEEDED) break ;;
      *)
        aws codebuild batch-get-builds --ids "$build_id" --region "$REGION" \
          --query 'builds[0].phases[?phaseStatus!=`SUCCEEDED` && phaseStatus!=null].{phase:phaseType,status:phaseStatus,ctx:contexts[0].message}' \
          --output table >&2 || true
        aws s3 rm "s3://${S3_BUCKET}/${key}" --region "$REGION" --only-show-errors || true
        die "codebuild $build_id ended with $status"
        ;;
    esac
  done
  aws s3 rm "s3://${S3_BUCKET}/${key}" --region "$REGION" --only-show-errors || true
  log "image pushed: ${ECR_URI}:${IMAGE_TAG} (+ latest)"
}

if [[ "$SKIP_BUILD" == 1 ]]; then
  log "SKIP_BUILD=1: not building; deploying ${ECR_URI}:latest as-is"
elif docker info >/dev/null 2>&1; then
  build_local
else
  build_remote
fi

# ---- service ----------------------------------------------------------------------
ECR_ACCESS_ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/covered-apprunner-ecr-access"
INSTANCE_ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/covered-apprunner-instance"

SOURCE_CONFIG="$(jq -cn \
  --arg img "${ECR_URI}:latest" --arg role "$ECR_ACCESS_ROLE_ARN" \
  --arg region "$REGION" --arg bucket "$S3_BUCKET" --arg table "$MEMORY_TABLE" \
  --arg bregion "$BEDROCK_REGION" --arg model "$BEDROCK_MODEL_ID" '{
  ImageRepository: {
    ImageIdentifier: $img,
    ImageRepositoryType: "ECR",
    ImageConfiguration: {
      Port: "3000",
      RuntimeEnvironmentVariables: {
        AWS_REGION: $region,
        S3_BUCKET: $bucket,
        COVERED_READER_DISABLED: "1",
        BEDROCK_REGION: $bregion,
        BEDROCK_MODEL_ID: $model,
        MEMORY_TABLE: $table,
        COVERED_MEMORY_TABLE: $table,
        HOSTNAME: "0.0.0.0"
      }
    }
  },
  AutoDeploymentsEnabled: true,
  AuthenticationConfiguration: { AccessRoleArn: $role }
}')"
INSTANCE_CONFIG="$(jq -cn --arg role "$INSTANCE_ROLE_ARN" \
  '{Cpu:"1 vCPU", Memory:"2 GB", InstanceRoleArn:$role}')"
HEALTH_CONFIG='{"Protocol":"HTTP","Path":"/","Interval":10,"Timeout":5,"HealthyThreshold":1,"UnhealthyThreshold":5}'

service_arn() {
  aws apprunner list-services --region "$REGION" \
    --query "ServiceSummaryList[?ServiceName=='${SERVICE}'].ServiceArn | [0]" --output text \
    | sed 's/^None$//'
}
service_status() {
  aws apprunner describe-service --service-arn "$1" --region "$REGION" \
    --query 'Service.Status' --output text
}
wait_stable() {
  local arn="$1" st
  while :; do
    st="$(service_status "$arn")"
    case "$st" in
      OPERATION_IN_PROGRESS) log "service $st ..."; sleep 20 ;;
      RUNNING) return 0 ;;
      *) die "service status: $st (check the App Runner console event log)" ;;
    esac
  done
}

ARN="$(service_arn)"
if [[ -z "$ARN" ]]; then
  log "creating App Runner service: $SERVICE"
  ARN="$(aws apprunner create-service --region "$REGION" \
    --service-name "$SERVICE" \
    --source-configuration "$SOURCE_CONFIG" \
    --instance-configuration "$INSTANCE_CONFIG" \
    --health-check-configuration "$HEALTH_CONFIG" \
    --tags Key=Project,Value=covered \
    --query 'Service.ServiceArn' --output text)"
else
  log "service exists: $ARN"
  wait_stable "$ARN"   # an ECR push may have kicked off an auto-deploy; let it finish
  log "updating service config (env, image, roles)"
  for attempt in 1 2 3 4 5 6; do
    if aws apprunner update-service --region "$REGION" --service-arn "$ARN" \
         --source-configuration "$SOURCE_CONFIG" \
         --instance-configuration "$INSTANCE_CONFIG" \
         --health-check-configuration "$HEALTH_CONFIG" >/dev/null; then
      break
    fi
    [[ "$attempt" == 6 ]] && die "update-service kept failing"
    log "update-service rejected (operation in progress?), retry $attempt in 20s"
    sleep 20
  done
fi

log "waiting for $SERVICE to be RUNNING"
sleep 5
wait_stable "$ARN"

URL="$(aws apprunner describe-service --service-arn "$ARN" --region "$REGION" \
  --query 'Service.ServiceUrl' --output text)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${URL}/" || echo 000)"
log "GET https://${URL}/ -> HTTP $CODE"
echo
echo "service: $ARN"
echo "url:     https://${URL}"
echo "image:   ${ECR_URI}:${IMAGE_TAG}"
echo "model:   ${BEDROCK_MODEL_ID:-<empty: judge default>}"
