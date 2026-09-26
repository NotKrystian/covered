# Covered

A shopping bot you text. It buys now, or it waits for your price. It will pay more when the cheaper listing is a private seller or an untrustworthy venue, because those listings do not come with UK buyer rights.

A model on Amazon Bedrock (Claude Haiku 4.5, EU inference profile) decides the things a sort cannot: same item or not (from the photos, not the title), mislisting, business or private seller, trustworthy venue, which right applies. Code only compares pounds to the numbers you set. A small preference memory in DynamoDB remembers how you buy and leans the next judgement; the pound rule never reads it. Collaborator guide and live-host orchestration: `AGENTS.md`. App Runner is retired; `covered.kawuc.uk` is the EC2 Next container.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm build
pnpm lint
```

Package manager is **pnpm** (lockfile: `pnpm-lock.yaml`). Playwright Chromium is installed with `npx playwright install chromium`.

## Environment

Copy `.env.example` to `.env.local`. Never commit real values.

| Var | Purpose |
| --- | --- |
| `BEDROCK_MODEL_ID` | Bedrock model for the judge. Default `eu.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| `BEDROCK_REGION` | Optional. Bedrock + DynamoDB region; falls back to `AWS_REGION`, then `eu-west-2`. |
| `COVERED_MOCK` | `1` forces the deterministic mock judge. Also used automatically if Bedrock access fails. |
| `COVERED_MEMORY_TABLE` | DynamoDB table for preference memory. Default `covered-memory`. |
| `AWS_REGION` | `eu-west-2` (London). Bedrock and S3 both use it. |
| `AWS_PROFILE` | `default`. The SDK reads `~/.aws`; keys never enter the repo. |
| `S3_BUCKET` | `covered-hack-616532055961`. New bucket only; never an existing Kawuc bucket. |
| `NEXT_PUBLIC_APP_NAME` | `Covered`. |

## Shared contract

`src/lib/types.ts` holds every cross-boundary shape as a zod schema plus inferred type: `Offer`, `SearchResult`, `ReaderResponse`, `Listing`, `Decision`, `Verdict`, `Receipt`, `UserSettings`. `src/lib/money.ts` has `parsePricePence` / `formatPence`. Change these in one place and tell the room.

## Ownership

| Path | Owner | What goes here |
| --- | --- | --- |
| `src/app/page.tsx`, `src/components/`, `globals.css` | Judge+Memory | Chat, shortlist, sponsored marked as ads, the judge's sentence, Approve, Memory card. |
| `src/lib/judge/` | Judge+Memory | Bedrock Converse call, prompt, `Decision` parsing, mock, per-process mode probe. Pound rule in `src/lib/decision.ts`. |
| `src/lib/memory/` | Judge+Memory | DynamoDB `covered-memory`: summary, settings, last 25 events; `covered_uid` cookie; summary rewrite. `create-table.sh` makes the table. |
| `src/lib/fixtures/` | Judge+Memory | Four seeded `Listing`s with real photos, incl. the wrong-jacket mislisting. |
| `src/app/api/decide/`, `src/app/api/memory/` | Judge+Memory | Shortlist in, `Verdict` out (memory-aware). `GET/POST/DELETE /api/memory`. |
| `src/lib/reader/` | Reader | Playwright read of the `udm=28` first paint, both lists, deduped, typed challenge error. Headless by default; `COVERED_READER_CDP=http://127.0.0.1:9222` attaches to your own Chrome (start it with `scripts/chrome-debug.sh`, stop with `scripts/chrome-debug.sh stop`). CLI: `npx tsx scripts/read-grid.ts "query"`. |
| `src/app/api/search/` | Reader | Query in, `ReaderResponse` out. |
| `src/lib/s3.ts` | Infra | `receipts/{id}.json` PutObject to the new bucket. |
| `src/app/api/approve/` | Infra | `Receipt` in, S3 key out. |
| `infra/`, `scripts/` | Infra | Bucket creation, deploy, tunnel scripts. |
| `src/lib/types.ts`, `src/lib/money.ts` | Shared | Edit with care; everyone imports these. |

## Out of scope today

Paging through `start=10`, challenge bypass, limit watcher, 14-day clock, fault refund, new EC2/CloudFront, any write to an existing Kawuc bucket.

## Run / Deploy

Owned by Infra. One laptop runs everything; the public URL is a Cloudflare Tunnel into it.

### `.env.local`

| Key | Value |
| --- | --- |
| `BEDROCK_MODEL_ID` | Optional. Defaults to `eu.anthropic.claude-haiku-4-5-20251001-v1:0`. The EC2 role needs `bedrock:InvokeModel` on it and `dynamodb:GetItem/PutItem/DeleteItem` on `covered-memory`. |
| `COVERED_MOCK` | Optional. `1` runs the mock judge with no Bedrock calls. |
| `AWS_REGION` | `eu-west-2`. |
| `S3_BUCKET` | `covered-hack-616532055961`. |

AWS credentials come from the default credential chain (local `default` profile). Nothing AWS-shaped goes in `.env.local`.

### Local

```bash
pnpm dev                     # http://localhost:3000
```

### Demo (app + public URL)

```bash
scripts/demo.sh              # starts pnpm dev on :3000 and the Cloudflare Tunnel; Ctrl-C stops both
PORT=3100 scripts/demo.sh    # if :3000 is busy
scripts/tunnel.sh            # tunnel only, against an already-running pnpm dev
```

`scripts/demo.sh` prints the public URL once the tunnel is up. With a named tunnel it is `https://covered.kawuc.uk`; otherwise it is a throwaway `https://*.trycloudflare.com` URL that changes on every run. Logs go to `/tmp/covered-dev.log` and `/tmp/covered-tunnel.log`.

Cloudflare credentials live outside the repo in `~/.config/covered/cloudflare.env` (mode 600): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ACCOUNT_ID`, and, once created, `CLOUDFLARE_TUNNEL_TOKEN`. `scripts/tunnel.sh` sources it and picks the named tunnel when `CLOUDFLARE_TUNNEL_TOKEN` is present. To get there: grant the API token `Cloudflare Tunnel:Edit` (account) and `DNS:Edit` (zone `kawuc.uk`), then run `infra/cloudflare/setup-tunnel.py` once. It creates the `covered` tunnel, the ingress to `http://localhost:3000`, and the `CNAME covered.kawuc.uk` record, and writes the run token into that env file. Nothing under `~/.config/covered/` is ever committed; `*.env` is gitignored.

Fallback if the tunnel is down: `cloudflared tunnel --url http://localhost:3000` and read the new URL off the console (or just demo on `http://localhost:3000`).

### S3 receipts

`infra/aws/create-bucket.sh` creates `covered-hack-616532055961` in `eu-west-2` (idempotent): public access blocked, versioning on, objects expire after 30 days. Approve writes `receipts/{id}.json`; snapshots go to `searches/{slug}/{iso}.json`.

`POST /api/approve` takes a `Receipt` without `id` / `created_at` and returns `{ ok: true, id, key }` (400 on a bad body, 502 if S3 fails). `GET /api/approve?id=` returns the stored receipt.

```bash
aws s3 ls s3://covered-hack-616532055961/receipts/
```

### AWS (App Runner, `eu-west-2`)

The app runs as a container on **AWS App Runner** in London, not on a laptop tunnel.

```bash
scripts/deploy.sh                                   # build → push → create/update service → wait → URL
scripts/deploy.sh eu.anthropic.claude-sonnet-4-6    # same, and set BEDROCK_MODEL_ID on the service
```

- **Service** `covered`: `https://gvykkgiap5.eu-west-2.awsapprunner.com` (ARN `arn:aws:apprunner:eu-west-2:616532055961:service/covered/dfb181f38111470584d5d57c8e0e5d24`). 1 vCPU / 2 GB, port 3000, health check `GET /`, auto-deploys whenever `covered-apprunner:latest` is pushed.
- **Image**: the shared `Dockerfile` at the repo root (multi-stage, `next build` with `output: "standalone"`, non-root user) built with `--build-arg RUNTIME_IMAGE=node:22-slim`, so the App Runner image has no Playwright browsers (the default Playwright runtime stage is for the EC2 path in `deploy/`). ECR repo `616532055961.dkr.ecr.eu-west-2.amazonaws.com/covered-apprunner`, tagged with the short git SHA and `latest`. There is no Docker on this Mac, so `deploy.sh` zips the working tree to `s3://covered-hack-616532055961/build/` and the CodeBuild project `covered-image` runs the `docker build --platform linux/amd64` + push (`infra/aws/codebuild/buildspec.yml`). With a local Docker daemon it builds with `docker buildx` instead. `SKIP_BUILD=1 scripts/deploy.sh` only updates the service config.
- **Env on the service**: `AWS_REGION=eu-west-2`, `S3_BUCKET=covered-hack-616532055961`, `COVERED_READER_DISABLED=1` (Google blocks datacenter IPs; the reader goes straight to the snapshot fallback), `BEDROCK_REGION=eu-west-2`, `BEDROCK_MODEL_ID` (empty = the judge's default), `MEMORY_TABLE` / `COVERED_MEMORY_TABLE=covered-memory`.
- **Set the model**: `scripts/deploy.sh <model-id>` or `BEDROCK_MODEL_ID=<model-id> SKIP_BUILD=1 scripts/deploy.sh`. The script calls `update-service` with the full env and waits for the rollout. No secrets: the container authenticates with its instance role.
- **IAM** (`infra/aws/iam/`, created by `infra/aws/setup.sh`): `covered-apprunner-ecr-access` (App Runner pulls from ECR, managed `AWSAppRunnerServicePolicyForECRAccess`), `covered-apprunner-instance` (S3 Put/Get/List on the receipts bucket, DynamoDB Get/Put/Update/Delete/Query on `covered-memory`, `bedrock:InvokeModel*` on `*` because inference profiles need the wildcard), `covered-codebuild` (read `build/*` in the bucket, push to the ECR repo, CloudWatch logs).
- **Custom domain** `covered.kawuc.uk`: associated with the service (www disabled), status `pending_certificate_dns_validation` until the CNAMEs exist in Cloudflare. `scripts/dns-apply.sh` upserts them (DNS-only, not proxied) using `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` from `~/.config/covered/cloudflare.env`; the current token cannot edit DNS, so the exact records are in `infra/aws/DNS.md` for manual entry. `scripts/dns-apply.sh --print` shows them and the current status.
- **Cost** (looked up on the App Runner pricing page, 2026-09-26): $0.064 per vCPU-hour + $0.007 per GB-hour, so 1 vCPU / 2 GB is about **$0.078/hour while serving requests** (≈ $1.87/day, ≈ $56/month if busy 24/7) and about $0.014/hour when idle (provisioned memory only). The page lists those rates for us-east-1/eu-west-1; London is typically a few percent higher. Pause the service from the console or `aws apprunner pause-service` when not demoing. CodeBuild adds a few cents per build.
