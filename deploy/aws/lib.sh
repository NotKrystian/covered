# Shared helpers for deploy/aws/*.sh. Source after env.sh.

log() { printf '\033[1;34m[covered]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[covered] %s\033[0m\n' "$*" >&2; exit 1; }

require() {
  for bin in "$@"; do
    command -v "$bin" >/dev/null 2>&1 || die "missing dependency: $bin"
  done
}

# Instance ID of the running/pending covered-web instance, or empty.
find_instance() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${INSTANCE_NAME}" "Name=tag:Project,Values=${PROJECT}" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[] | sort_by(@, &LaunchTime)[-1].InstanceId' \
    --output text 2>/dev/null | sed 's/^None$//'
}

instance_state() {
  aws ec2 describe-instances --instance-ids "$1" \
    --query 'Reservations[0].Instances[0].State.Name' --output text
}

instance_ip() {
  aws ec2 describe-instances --instance-ids "$1" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text | sed 's/^None$//'
}

# Block until the SSM agent on the instance reports Online (max ~5 min).
wait_for_ssm() {
  local id="$1" i
  for i in $(seq 1 60); do
    local ping
    ping=$(aws ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=${id}" \
      --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
    [ "$ping" = "Online" ] && return 0
    sleep 5
  done
  die "SSM agent on ${id} never came online"
}

# run_ssm <instance-id> <timeout-seconds> <comment> <<'EOF' ... script ... EOF
# Runs a bash script on the box via SSM, streams nothing (SSM is poll-based),
# waits for completion, prints stdout/stderr, returns the remote exit status.
# Full output is also written to s3://$DEPLOY_BUCKET/ssm/ (SSM truncates inline
# output at 24 KB).
run_ssm() {
  local id="$1" timeout="$2" comment="$3"
  local script
  script=$(cat)
  local params
  params=$(jq -cn --arg s "$script" --arg t "$timeout" '{commands: [$s], executionTimeout: [$t]}')
  local cmd_id
  cmd_id=$(aws ssm send-command \
    --instance-ids "$id" \
    --document-name AWS-RunShellScript \
    --comment "$comment" \
    --timeout-seconds 600 \
    --parameters "$params" \
    --output-s3-bucket-name "$DEPLOY_BUCKET" --output-s3-key-prefix ssm \
    --query 'Command.CommandId' --output text)
  log "ssm command ${cmd_id}: ${comment}"

  local ssm_status
  while :; do
    ssm_status=$(aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
      --query Status --output text 2>/dev/null || echo Pending)
    case "$ssm_status" in
      Pending|InProgress|Delayed) sleep 5 ;;
      *) break ;;
    esac
  done

  aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
    --query 'StandardOutputContent' --output text
  aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
    --query 'StandardErrorContent' --output text >&2

  if [ "$ssm_status" != "Success" ]; then
    log "remote status: ${ssm_status} (full log: s3://${DEPLOY_BUCKET}/ssm/${cmd_id}/)"
    return 1
  fi
}

# Published Cloudflare IPv4 ranges (https://www.cloudflare.com/ips-v4). Used to
# lock origin :443 to the proxy so we can terminate TLS on the box.
CLOUDFLARE_IPV4=(
  173.245.48.0/20
  103.21.244.0/22
  103.22.200.0/22
  103.31.4.0/22
  141.101.64.0/18
  108.162.192.0/18
  190.93.240.0/20
  188.114.96.0/20
  197.234.240.0/22
  198.41.128.0/17
  162.158.0.0/15
  104.16.0.0/13
  104.24.0.0/14
  172.64.0.0/13
  131.0.72.0/22
)

# Open 443/tcp on the covered-web SG if missing. Prefer Cloudflare IPv4 only;
# fall back to 0.0.0.0/0 so a hackathon demo still works if the list is rejected.
ensure_https_sg() {
  local sg_id="$1"
  local existing
  existing=$(aws ec2 describe-security-groups --group-ids "$sg_id" \
    --query 'SecurityGroups[0].IpPermissions[?FromPort==`443`]' --output json)
  if [ "$existing" != "[]" ]; then
    log "security group ${sg_id} already allows 443"
    return 0
  fi
  local ranges perm
  ranges=$(printf '%s\n' "${CLOUDFLARE_IPV4[@]}" | jq -R . | jq -s .)
  perm=$(jq -cn --argjson cidrs "$ranges" '[{
    IpProtocol: "tcp", FromPort: 443, ToPort: 443,
    IpRanges: [ $cidrs[] | {CidrIp: ., Description: "cloudflare"} ]
  }]')
  if aws ec2 authorize-security-group-ingress --group-id "$sg_id" --ip-permissions "$perm" >/dev/null; then
    log "opened 443/tcp from Cloudflare IPv4 on ${sg_id}"
    return 0
  fi
  log "Cloudflare-only 443 failed; opening 443/tcp from 0.0.0.0/0"
  aws ec2 authorize-security-group-ingress --group-id "$sg_id" \
    --ip-permissions 'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=https}]' >/dev/null
}
