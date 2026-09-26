#!/usr/bin/env bash
# Tear down everything deploy/aws/up.sh created. Does NOT touch the receipts
# bucket (covered-hack-*), Cloudflare, or anything not tagged by these scripts.
#
#   deploy/aws/down.sh          # asks for confirmation
#   deploy/aws/down.sh --yes    # no prompt
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
require aws jq

if [ "${1:-}" != "--yes" ]; then
  read -r -p "Terminate ${INSTANCE_NAME}, delete ECR repo ${ECR_REPO}, bucket ${DEPLOY_BUCKET}, role ${ROLE_NAME}, SG ${SG_NAME} in ${AWS_REGION}? [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || die "aborted"
fi

# ---- instance(s) ------------------------------------------------------------
IDS=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=${INSTANCE_NAME}" "Name=tag:Project,Values=${PROJECT}" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
if [ -n "$IDS" ]; then
  log "terminating ${IDS}"
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --instance-ids $IDS >/dev/null
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --instance-ids $IDS
fi

# ---- security group ---------------------------------------------------------
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | sed 's/^None$//')
if [ -n "$SG_ID" ]; then
  log "deleting security group ${SG_ID}"
  for _ in $(seq 1 12); do aws ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null && break; sleep 5; done
fi

# ---- IAM --------------------------------------------------------------------
if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  log "deleting instance profile ${PROFILE_NAME}"
  aws iam remove-role-from-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" 2>/dev/null || true
  aws iam delete-instance-profile --instance-profile-name "$PROFILE_NAME"
fi
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "deleting role ${ROLE_NAME}"
  aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null || true
  aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name covered-app 2>/dev/null || true
  aws iam delete-role --role-name "$ROLE_NAME"
fi

# ---- ECR + deploy bucket --------------------------------------------------------
if aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1; then
  log "deleting ECR repo ${ECR_REPO} (and its images)"
  aws ecr delete-repository --repository-name "$ECR_REPO" --force >/dev/null
fi
if aws s3api head-bucket --bucket "$DEPLOY_BUCKET" >/dev/null 2>&1; then
  log "emptying and deleting ${DEPLOY_BUCKET}"
  aws s3 rm --only-show-errors --recursive "s3://${DEPLOY_BUCKET}"
  aws s3api delete-bucket --bucket "$DEPLOY_BUCKET"
fi

log "done. Receipts bucket ${S3_BUCKET} and Cloudflare DNS were left alone."
