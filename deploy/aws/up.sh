#!/usr/bin/env bash
# Create (idempotently) everything Covered needs on AWS and do the first deploy:
# ECR repo, deploy-artifacts bucket, IAM role + instance profile, security
# group, one t4g.medium running the container. Safe to re-run: every step is a
# create-if-missing. No SSH key, no port 22 — use `aws ssm start-session`.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
source "$HERE/env.sh"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
require aws jq

log "account ${ACCOUNT_ID} / region ${AWS_REGION}"
[ "$(aws sts get-caller-identity --query Account --output text)" = "$ACCOUNT_ID" ] \
  || die "default AWS profile is not account ${ACCOUNT_ID}"

# ---- ECR ------------------------------------------------------------------
if ! aws ecr describe-repositories --repository-names "$ECR_REPO" >/dev/null 2>&1; then
  log "creating ECR repo ${ECR_REPO}"
  aws ecr create-repository --repository-name "$ECR_REPO" \
    --image-scanning-configuration scanOnPush=false \
    --tags "Key=Project,Value=${PROJECT}" >/dev/null
  # keep the last 5 images only
  aws ecr put-lifecycle-policy --repository-name "$ECR_REPO" --lifecycle-policy-text \
    '{"rules":[{"rulePriority":1,"description":"keep last 5","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}' >/dev/null
else
  log "ECR repo ${ECR_REPO} exists"
fi

# ---- deploy bucket (source tarballs + SSM command output) ------------------
if ! aws s3api head-bucket --bucket "$DEPLOY_BUCKET" >/dev/null 2>&1; then
  log "creating bucket ${DEPLOY_BUCKET}"
  aws s3api create-bucket --bucket "$DEPLOY_BUCKET" \
    --create-bucket-configuration "LocationConstraint=${AWS_REGION}" >/dev/null
  aws s3api put-public-access-block --bucket "$DEPLOY_BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-tagging --bucket "$DEPLOY_BUCKET" --tagging "TagSet=[{Key=Project,Value=${PROJECT}}]"
  aws s3api put-bucket-lifecycle-configuration --bucket "$DEPLOY_BUCKET" --lifecycle-configuration \
    '{"Rules":[{"ID":"expire","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":7}}]}'
else
  log "bucket ${DEPLOY_BUCKET} exists"
fi

# ---- IAM role + instance profile -------------------------------------------
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "creating IAM role ${ROLE_NAME}"
  aws iam create-role --role-name "$ROLE_NAME" --tags "Key=Project,Value=${PROJECT}" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
else
  log "IAM role ${ROLE_NAME} exists"
fi
aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
# Inline policy is re-put every run so edits here take effect on re-run.
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name covered-app --policy-document "$(jq -cn \
  --arg receipts "arn:aws:s3:::${S3_BUCKET}" \
  --arg deploy "arn:aws:s3:::${DEPLOY_BUCKET}" \
  --arg ecr "arn:aws:ecr:${AWS_REGION}:${ACCOUNT_ID}:repository/${ECR_REPO}" \
  --arg memory "arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/${MEMORY_TABLE}" \
  --arg jobs "arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/${JOBS_TABLE}" '
{
  Version: "2012-10-17",
  Statement: [
    { Sid: "Bedrock", Effect: "Allow",
      Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], Resource: "*" },
    { Sid: "Receipts", Effect: "Allow",
      Action: ["s3:PutObject", "s3:GetObject"], Resource: ($receipts + "/*") },
    { Sid: "ReceiptsList", Effect: "Allow", Action: ["s3:ListBucket"], Resource: $receipts },
    { Sid: "Memory", Effect: "Allow",
      Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
      Resource: $memory },
    { Sid: "Jobs", Effect: "Allow",
      Action: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"],
      Resource: $jobs },
    { Sid: "DeployArtifacts", Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject"], Resource: ($deploy + "/*") },
    { Sid: "DeployArtifactsList", Effect: "Allow", Action: ["s3:ListBucket"], Resource: $deploy },
    { Sid: "EcrAuth", Effect: "Allow", Action: ["ecr:GetAuthorizationToken"], Resource: "*" },
    { Sid: "EcrPullPush", Effect: "Allow",
      Action: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability",
               "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage"],
      Resource: $ecr }
  ]
}')"
if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  log "creating instance profile ${PROFILE_NAME}"
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" \
    --tags "Key=Project,Value=${PROJECT}" >/dev/null
fi
if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" \
     --query 'InstanceProfile.Roles[].RoleName' --output text | grep -qw "$ROLE_NAME"; then
  aws iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME"
  log "waiting for instance profile to propagate"; sleep 10
fi

# ---- security group (80/tcp anywhere; 443/tcp from Cloudflare for origin TLS) -----
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[ -n "$VPC_ID" ] && [ "$VPC_ID" != "None" ] || die "no default VPC in ${AWS_REGION}"
SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null | sed 's/^None$//')
if [ -z "$SG_ID" ]; then
  log "creating security group ${SG_NAME}"
  SG_ID=$(aws ec2 create-security-group --group-name "$SG_NAME" --vpc-id "$VPC_ID" \
    --description "Covered web: 80/tcp from the internet; 443/tcp from Cloudflare" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=${PROJECT}}]" \
    --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions 'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=http}]' >/dev/null
else
  log "security group ${SG_NAME} = ${SG_ID}"
fi
ensure_https_sg "$SG_ID"

# ---- EC2 instance -----------------------------------------------------------
INSTANCE_ID=$(find_instance)
if [ -z "$INSTANCE_ID" ]; then
  AMI_ID=$(aws ssm get-parameter --name "$AMI_PARAM" --query Parameter.Value --output text)
  SUBNET_ID=$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${VPC_ID}" Name=default-for-az,Values=true Name=map-public-ip-on-launch,Values=true \
    --query 'Subnets[0].SubnetId' --output text)
  log "launching ${INSTANCE_TYPE} from ${AMI_ID} in ${SUBNET_ID}"

  USER_DATA=$(mktemp)
  trap 'rm -f "$USER_DATA"' EXIT
  # Values known now are baked in; the remote /opt/covered/env is rewritten by
  # redeploy.sh from env.sh on every deploy, so edits there win later.
  cat >"$USER_DATA" <<EOF
#!/bin/bash
set -euxo pipefail
dnf install -y docker
systemctl enable --now docker
# 2 GB swap: the image is built on this box and \`next build\` likes headroom.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi
mkdir -p /opt/covered
cat >/opt/covered/env <<ENV
AWS_REGION=${AWS_REGION}
S3_BUCKET=${S3_BUCKET}
BEDROCK_MODEL_ID=${BEDROCK_MODEL_ID}
COVERED_MEMORY_TABLE=${MEMORY_TABLE}
COVERED_JOBS_TABLE=${JOBS_TABLE}
ENV
for kv in ${EXTRA_CONTAINER_ENV}; do echo "\$kv" >>/opt/covered/env; done
cat >/opt/covered/run.sh <<'RUN'
#!/bin/bash
# Pull :latest from ECR and (re)start the container. Idempotent.
set -euo pipefail
ECR_URI="${ECR_URI}"
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin "\${ECR_URI%%/*}"
docker pull "\${ECR_URI}:latest"
docker rm -f ${CONTAINER_NAME} 2>/dev/null || true
docker run -d --name ${CONTAINER_NAME} --restart unless-stopped \\
  -p 80:3000 --shm-size=1g --env-file /opt/covered/env \\
  "\${ECR_URI}:latest"
docker image prune -f >/dev/null
RUN
chmod +x /opt/covered/run.sh
# First boot usually has no image yet; deploy/aws/redeploy.sh builds and starts it.
/opt/covered/run.sh || echo "covered: no image in ECR yet, waiting for redeploy.sh"
EOF

  for attempt in 1 2 3 4 5 6; do
    if INSTANCE_ID=$(aws ec2 run-instances \
        --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
        --subnet-id "$SUBNET_ID" --security-group-ids "$SG_ID" \
        --associate-public-ip-address \
        --iam-instance-profile "Name=${PROFILE_NAME}" \
        --block-device-mappings "[{\"DeviceName\":\"/dev/xvda\",\"Ebs\":{\"VolumeSize\":${VOLUME_GB},\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
        --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled \
        --user-data "file://${USER_DATA}" \
        --tag-specifications \
          "ResourceType=instance,Tags=[{Key=Name,Value=${INSTANCE_NAME}},{Key=Project,Value=${PROJECT}}]" \
          "ResourceType=volume,Tags=[{Key=Name,Value=${INSTANCE_NAME}},{Key=Project,Value=${PROJECT}}]" \
        --query 'Instances[0].InstanceId' --output text 2>/tmp/covered-run-instances.err); then
      break
    fi
    # Fresh instance profiles take a few seconds to become visible to EC2.
    grep -q 'Invalid IAM Instance Profile' /tmp/covered-run-instances.err || { cat /tmp/covered-run-instances.err >&2; die "run-instances failed"; }
    log "instance profile not visible yet, retry ${attempt}"; sleep 10
  done
  [ -n "${INSTANCE_ID:-}" ] || die "run-instances failed after retries"
  log "instance ${INSTANCE_ID}"
else
  log "instance ${INSTANCE_ID} exists ($(instance_state "$INSTANCE_ID"))"
  if [ "$(instance_state "$INSTANCE_ID")" = "stopped" ]; then
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
  fi
fi

log "waiting for instance to run and pass status checks"
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"
wait_for_ssm "$INSTANCE_ID"
log "public IP: $(instance_ip "$INSTANCE_ID")"

# ---- first deploy, then origin TLS (nginx :443 → container :80) -----------------
"$HERE/redeploy.sh"
exec "$HERE/tls.sh"
