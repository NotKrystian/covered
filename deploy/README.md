# Deploy — Covered on AWS

One `t4g.medium` (Graviton, arm64) in `eu-west-2` runs the app as a Docker
container. Cloudflare proxies `covered.kawuc.uk` to the instance's public IP and
terminates TLS; the box only listens on port 80. No SSH, no key pairs: shell
access is `aws ssm start-session`.

Everything is scripted and idempotent under `deploy/aws/`. All resources are
tagged `Project=covered`. No secrets anywhere: the container authenticates to
Bedrock, S3 and DynamoDB with the instance's IAM role.

## What gets created

| Resource | Name / ID | Notes |
| --- | --- | --- |
| ECR repository | `covered` → `616532055961.dkr.ecr.eu-west-2.amazonaws.com/covered` | `:latest` + one tag per deploy; lifecycle keeps the last 5 images |
| S3 bucket | `covered-deploy-616532055961` | source tarballs for remote builds + SSM command output; objects expire after 7 days; public access blocked |
| IAM role + instance profile | `covered-ec2` | `AmazonSSMManagedInstanceCore` + inline `covered-app`: `bedrock:InvokeModel*` on `*`, `s3:Get/Put/List` on `covered-hack-616532055961` and the deploy bucket, `dynamodb:Get/Put/Update/DeleteItem` on `covered-memory`, ECR pull + push on `covered` |
| Security group | `covered-web` (default VPC) | inbound `80/tcp` from `0.0.0.0/0`; no `22` |
| EC2 instance | tag `Name=covered-web`, `t4g.medium`, 20 GB gp3, latest AL2023 arm64 | public IP, IMDSv2 (hop limit 2 so the container can reach the role), Docker from user-data, 2 GB swap |

The receipts bucket `covered-hack-616532055961` is **not** created or modified
here (Infra owns it); the role is only granted access to it. Same for the
`covered-memory` DynamoDB table and Cloudflare DNS.

Current deployment: instance `i-0be6351eb53244b66`, public IP `3.8.77.227`
(`deploy/aws/status.sh` prints the live value).

## The three commands

```bash
deploy/aws/up.sh        # create anything missing, launch the box, first deploy
deploy/aws/redeploy.sh  # after every code change: build image, push, restart
deploy/aws/status.sh    # state, public IP, curl -sI, last 30 container log lines
```

`redeploy.sh` ships the **working tree** (tracked + untracked, gitignored files
excluded so `.env*` never leaves the laptop); `DEPLOY_REF=HEAD deploy/aws/redeploy.sh`
ships a committed ref instead. If Docker is running locally it
builds with `docker buildx build --platform linux/arm64 --push`; if not (the
default on this Mac, which has no Docker) it tars the source, uploads it to the
deploy bucket and builds natively on the Graviton box via SSM, then pushes to
ECR from there. Docker's layer cache on the box makes repeat builds fast unless
`pnpm-lock.yaml` changes. Either way the box then pulls `:latest` and restarts
the container.

Container env comes from `deploy/aws/env.sh` (`AWS_REGION`, `S3_BUCKET`,
`BEDROCK_MODEL_ID`, `COVERED_MEMORY_TABLE`, plus anything in
`EXTRA_CONTAINER_ENV`). Edit it and run `redeploy.sh`; the remote
`/opt/covered/env` is rewritten on every deploy. To change the Bedrock model:

```bash
# edit BEDROCK_MODEL_ID in deploy/aws/env.sh, then
deploy/aws/redeploy.sh
```

## The container

`Dockerfile` (multi-stage, arm64):

- build: `node:22-bookworm-slim`, corepack `pnpm@10.11.0`, `pnpm install --frozen-lockfile`, `pnpm build` with `output: "standalone"` from `next.config.ts`.
- runtime: `mcr.microsoft.com/playwright:v1.63.0-noble` (matches `playwright@1.63.0` in `package.json`, so Chromium and its libraries are present). Copies `.next/standalone`, `.next/static`, `public`; runs `node server.js` as the non-root `covered` user on `:3000`, mapped to `:80` on the host with `--shm-size=1g` for Chromium. `--build-arg RUNTIME_IMAGE=node:22-slim` gives a browser-less image for `COVERED_READER_DISABLED=1` targets.
- `next.config.ts` also sets `outputFileTracingIncludes` for `playwright`/`playwright-core`: Next's tracer misses `browsers.json` and the reader crashes in the standalone bundle without it.

On the box: `/opt/covered/run.sh` (pull + restart), `/opt/covered/env`,
`/opt/covered/build.log` (last remote build), `/opt/covered/src` (last shipped tree).

```bash
aws ssm start-session --target <instance-id>     # needs the session-manager-plugin
sudo docker logs -f covered
```

## Smoke checks

```bash
IP=$(deploy/aws/status.sh | awk '/public ip/ {print $3}')
curl -sI "http://$IP/"                                              # 200 from Next
curl -s -X POST "http://$IP/api/decide" -H 'content-type: application/json' \
  -d '{"query":"black fleece jacket medium","source":"fixture"}'    # JSON verdict
curl -s -X POST "http://$IP/api/search" -H 'content-type: application/json' \
  -d '{"query":"black fleece jacket medium"}'                       # from an AWS IP Google serves /sorry/ → typed `challenge` live error → snapshot fallback
```

Verified 2026-09-26: `/` 200; `/api/decide` returns a verdict with `mode: "bedrock"`
(~13 s); `/api/search` returns 200 with `source: "snapshot"` after Chromium hit
Google's interstitial (visible in `docker logs`).

## Cost (eu-west-2, on-demand, USD)

| Item | Per hour | Per day |
| --- | --- | --- |
| `t4g.medium` Linux | 0.0376 | 0.90 |
| Public IPv4 | 0.005 | 0.12 |
| 20 GB gp3 root | ~0.0026 | ~0.06 |
| ECR (~2.5 GB of images) + deploy bucket | ~0.0004 | ~0.01 |
| **Total** | **≈ 0.046** | **≈ 1.10** |

Bedrock, S3 requests and DynamoDB are usage-priced on top and negligible at
hackathon volume. Data transfer out is free for the first 100 GB/month.

## Tear down

```bash
deploy/aws/down.sh        # prompts; --yes to skip
```

Terminates the instance (root volume is delete-on-termination), deletes the
security group, instance profile, role and inline policy, the ECR repo with all
images, and empties + deletes the deploy bucket. It never touches the receipts
bucket, the `covered-memory` table, or Cloudflare.

## Deviations from the brief

- Image is built **on the instance**, not locally: this Mac has no Docker. The
  script uses local buildx automatically when Docker is present.
- Because of that, the role also has ECR **push** on the `covered` repo and
  read/write on a small deploy bucket, `covered-deploy-616532055961`.
- `BEDROCK_MODEL_ID` default in `env.sh` is `eu.anthropic.claude-sonnet-4-6`,
  matching the default the Decision agent shipped in `src/lib/judge`, rather
  than the older placeholder in the brief.
- DynamoDB permissions were added for the `src/lib/memory` module that landed
  while this was being built.
- The Dockerfile takes `RUNTIME_IMAGE` as a build arg so the Infra agent's
  browser-less App Runner build can share it instead of maintaining a second
  Dockerfile.
