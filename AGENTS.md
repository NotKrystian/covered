<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Covered — guide for humans and agents

Covered is a UK shopping bot you text. It buys the cheapest listing that is actually the item and still has your buyer rights, paying up to a premium you set (default £10) to avoid private sellers and unenforceable venues. Bedrock judges identity, mislisting (from the photos, not the title), seller type, venue trust and which right applies; code compares pence; DynamoDB memory remembers how you buy so the next judgement leans your way.

Mislistings and not-the-item listings are dropped before any price is compared. Memory changes the model's recommendation and sentence only; it never touches `same_item`, `mislisting`, or the pound rule.

## Orchestration

Source of truth for the next Cursor agent or **alan-d-smith**. Do not invent product features. Another agent may be concurrently adding `src/app/ext` (installer) — do not revert or overwrite their files.

- **Live host:** https://covered.kawuc.uk (proxied A → EC2 `i-0be6351eb53244b66`, public IP `3.8.77.227`, `eu-west-2`). HTTP `:80` is the Next container. HTTPS is nginx `:443` with Let's Encrypt. Security group: 443 only from Cloudflare. Redeploy with `deploy/aws/redeploy.sh`. **Do not start a second App Runner** — that path was retired.
- **AWS:** account `616532055961`, region `eu-west-2`, profile `default`. Bucket `covered-hack-616532055961` (`receipts/`, `searches/`). DynamoDB `covered-memory`. Do not write other Kawuc buckets or DNS records except `covered.kawuc.uk`.
- **Judge:** Bedrock `eu.anthropic.claude-haiku-4-5-20251001-v1:0` via `BEDROCK_MODEL_ID`. Mock if `COVERED_MOCK=1`. The pound rule stays in code (`applyPremium`). Mislistings never reach the price comparison. No xAI / Grok.
- **Catalog:** Live grid prefers the user's Brave via the MV3 extension in `extension/` (background tab, their Google session). Installer page `/ext`. Do **not** CDP-attach or launch the user's Brave/Chrome. Server Playwright gets Google's `/sorry/` from the datacenter; exact-slug snapshots in `public/snapshots/` are fallback only. Fixtures are only the black-fleece demo; never answer a different query with those four listings.
- **Cloudflare:** token lives in `~/.config/covered/cloudflare.env` (mode 600). Never commit it. Never print it. DNS:Edit on zone `kawuc.uk`. Zone SSL stays **Full (strict)**.
- **Git:** commit only your own paths with explicit `git add <path>`; never `git add -A` or `git add .`; never sweep another agent's staged or unstaged files. Run `pnpm build && npx tsc --noEmit` before every push. Rebase only on a clean tree. No secrets in the repo. No force-push.
- **Demo:** exact 3-minute run is in **[`DEMO.md`](DEMO.md)**. Code freeze was 16:30, live demo 17:30, viewport ≥1400px, click **Forget me** first.
- **Collaborator:** `alan-d-smith` has write on https://github.com/NotKrystian/covered (private).

## Architecture

```mermaid
flowchart LR
  U[User in chat] -->|query + settings| P[page.tsx]
  P -->|POST /api/search| R[Reader<br/>Brave MV3 extension<br/>or snapshot / fixtures]
  R -->|Offer[]| P
  P -->|POST /api/decide| D[decide route]
  D --> S[Shortlist<br/>dedupe, sort, cap 12]
  D -->|getMemory| M[(DynamoDB<br/>covered-memory)]
  S --> J[Judge<br/>Bedrock Converse + fixture photos<br/>JSON validated with zod]
  M -->|summary + last 5 events| J
  J -->|Decision per id| PR[Pound rule<br/>applyPremium in code]
  PR -->|Verdict + trace| P
  D -->|recordEvent decision| M
  P -->|Approve → POST /api/approve| S3[(S3 receipts/{id}.json)]
  P -->|POST /api/memory approve| MR[memory route]
  MR -->|rewrite summary via Bedrock| M
```

## Folder ownership

Commit only your own paths. If you need a change elsewhere, ask the owner in the room. Do not revert or overwrite another agent's in-progress files (including `src/app/ext`).

| Path | Owner | What lives here |
| --- | --- | --- |
| `src/lib/reader/`, `src/app/api/search/`, `public/snapshots/` | Reader | Ingest of client offers from the extension; server Playwright (datacenter `/sorry/`); exact-slug snapshot fallback; typed challenge error. |
| `extension/` | Extension | MV3 Brave/Chrome reader: background tab on the user's Google session. Does not CDP-attach or launch a browser. |
| `src/app/ext/` | Extension | Installer page at `/ext`. Another agent may be adding this — leave their files alone. |
| `src/lib/judge/` | Judge | Bedrock client + per-process mode probe (`bedrock.ts`), prompt with the rights card, JSON parse/retry, mock. |
| `src/lib/memory/` | Memory | DynamoDB memory (`index.ts`), `covered_uid` cookie (`identity.ts`), summary rewrite (`summary.ts`), `create-table.sh`. |
| `src/lib/fixtures/`, `public/fixtures/` | Fixtures | Four seeded listings with photos for the black-fleece demo only, incl. the wrong-jacket mislisting. |
| `src/lib/decision.ts` | Decision | Shortlist shape, pound rule (`applyPremium`), `DecideResponse`. |
| `src/app/page.tsx`, `src/components/`, `src/app/globals.css` | UI | Three-panel UI: chat, shortlist, trace + Memory card. Keep the layout and colours. |
| `src/app/api/decide/`, `src/app/api/memory/` | API (Judge+Memory) | Shortlist → verdict (memory-aware). GET/POST/DELETE memory. |
| `src/app/api/approve/` | API (Infra) | Receipt in, S3 key out. No card, no checkout. |
| `src/lib/s3.ts` | Infra | Receipt write/read to S3. |
| `deploy/aws/` | Infra | EC2 live host: `up.sh`, `redeploy.sh`, `tls.sh`, `status.sh`, `down.sh`, `env.sh`. |
| `infra/aws/` | Infra | Receipts bucket, IAM leftovers (incl. retired App Runner), DNS notes. Do not edit `infra/aws/DNS.md` unless you own DNS. |
| `src/lib/types.ts`, `src/lib/money.ts` | Shared | Every cross-boundary zod schema. Edit with care and tell the room. |

## Run

```bash
pnpm install
npx playwright install chromium          # Reader only (server fallback)
src/lib/memory/create-table.sh           # once per AWS account; idempotent
pnpm dev                                 # http://localhost:3000
pnpm build && npx tsc --noEmit           # before every push
COVERED_MOCK=1 pnpm dev                  # no Bedrock calls; template summaries
```

Quick checks (dev server running):

```bash
curl -s localhost:3000/api/decide -H 'content-type: application/json' \
  -d '{"query":"black fleece jacket medium","source":"fixture"}' | jq '{mode, model, chosen: .verdict.chosen_id}'
curl -s localhost:3000/api/decide -H 'content-type: application/json' \
  -d '{"query":"black fleece jacket medium","source":"fixture","settings":{"protection_premium_pence":500}}' | jq .verdict.chosen_id
curl -s -c c.txt -b c.txt localhost:3000/api/memory | jq .memory.summary
```

Live grid in the browser needs the unpacked extension (`extension/README.md`) and `NEXT_PUBLIC_COVERED_EXTENSION_ID` (or `localStorage.covered_extension_id` on the live host).

## Environment (names only; values live in `.env.local` or `~/.aws`)

| Var | Meaning |
| --- | --- |
| `AWS_REGION` / `AWS_PROFILE` | Default credential chain. `eu-west-2`, profile `default`. Never put keys in the repo. |
| `BEDROCK_MODEL_ID` | Judge model. Default `eu.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| `BEDROCK_REGION` | Optional override for Bedrock + DynamoDB; falls back to `AWS_REGION`, then `eu-west-2`. |
| `COVERED_MOCK` | `1` forces the deterministic judge and template summaries. |
| `COVERED_MEMORY_TABLE` | DynamoDB table. Default `covered-memory`. |
| `S3_BUCKET` | Receipts bucket. |
| `NEXT_PUBLIC_COVERED_EXTENSION_ID` | Unpacked MV3 reader id. See `extension/README.md`. |
| `NEXT_PUBLIC_APP_NAME` | `Covered`. |

Do not set or use `COVERED_READER_CDP`. Do not CDP-attach or launch the user's Brave/Chrome.

Cloudflare credentials are **not** env vars in the app. They live only in `~/.config/covered/cloudflare.env` (gitignored, mode 600).

## AWS resources

| Resource | Value |
| --- | --- |
| Account | `616532055961` |
| Region | `eu-west-2` (London) |
| Live host | EC2 `i-0be6351eb53244b66` (`t4g.medium`, public IP `3.8.77.227`). Next on `:80`; nginx TLS on `:443`. Redeploy: `deploy/aws/redeploy.sh`. |
| DNS | `covered.kawuc.uk` — proxied A to that IP. Zone SSL Full (strict). No other `kawuc.uk` records. |
| S3 bucket | `covered-hack-616532055961` — receipts at `receipts/{id}.json`, snapshots at `searches/{slug}/{iso}.json` |
| DynamoDB table | `covered-memory` — on-demand, PK `user_id` (string). Item: `{ user_id, display_name?, summary ≤ 600 chars, settings, events[≤ 25], updated_at }` |
| Bedrock model | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` — EU cross-region inference profile, vision input, **$1.00 per 1M input / $5.00 per 1M output tokens**. Budget fallback via `BEDROCK_MODEL_ID`: `amazon.nova-lite-v1:0`. No xAI / Grok. |

App Runner (`covered` / `covered-apprunner`) was retired. Do not create another service.

Anything else in this account (other Kawuc buckets, other DNS records, other EC2) is off limits.

## Conventions

- No secrets in the repo, ever: not in code, `.env.example`, rules, commit messages, or chat summaries. `.env.local` and `*.env` are gitignored. Never print the Cloudflare token.
- Model output is JSON only, validated with zod (`DecisionSchema`, `MemorySchema`). Retry once with the parse error appended, then fall back to the mock for that item. Never trust unparsed text.
- Mock mode must always work: `COVERED_MOCK=1` and any Bedrock/DynamoDB failure degrade to the deterministic judge, template summary, and an in-process memory Map, with the reason in the trace.
- The pound rule stays in code (`applyPremium`). The model never sees the premium as something to apply, and a mislisting never reaches the price comparison.
- Every trace line is real: `read_fixtures` / `read_grid`, `learned` (memory was injected), `judge` (mode + model id), `apply_premium`, `memory`.
- Commit only your own paths with explicit `git add <path>`; never `git add -A` or `git add .`; never sweep another agent's staged files. Run `pnpm build && npx tsc --noEmit` before every push. Rebase only on a clean tree; never `git stash --include-untracked` while others have uncommitted work. No force-push.
- Imports at the top of the file. Exhaustive `switch` with a `never` default over unions. Keep the three-panel layout and colours; do not redesign.

## Demo script (one clock button, four fixtures, one chat)

The exact 3-minute run — start commands, warm-up curls, the four clicks, what to say at each, timings, and what to do when Bedrock is slow or `/api/search` fails — is in **[`DEMO.md`](DEMO.md)**. Code freeze 16:30, live demo 17:30, viewport ≥1400px, **Forget me** first.

The beats, for reference:

0. **The real shelf.** Hit Live grid. Prefers the user's Brave via the MV3 extension; otherwise the badge says `snapshot · captured <date>` (exact-slug fallback) — never the four fixtures for a different query. Ads carry an `Ad` chip; browse rows show their returns line. Twelve rows (at most 4 ads) go to the judge with no photos, so it is told it cannot call a mislisting.
1. **The photo beat.** Type the fleece, hit Fixtures. The £22 "Nike Tech Fleece" has the right title and a photo of a nylon bomber. The judge drops it from the picture before any price rule runs; the row is struck through with the photo reason.
2. **The rights beat, £10.** Private seller £28 vs JD Sports £36. Gap £8 is inside the £10 premium, so it buys the shop and says exactly what the £8 buys: 14-day cancellation and a 30-day fault refund. The overseas "shop" at £34 gets no premium: a business badge is not protection.
3. **The flip, £10 → £5.** Change "Pay up to" to 5 and Re-run. Same judgements, but now the £8 gap beats the premium: it buys the private listing and warns that a break is your problem. Same model output, different pound rule, deterministic.
4. **Memory.** Approve the JD Sports pick. The Memory card fills with a Bedrock-written summary and the last events; the next run shows a `learned` trace line and the judge's sentences lean towards "your proven choice". "Forget me" wipes it.

Say it in one line: it does not buy the cheapest listing. It buys the cheapest listing that is actually the item and still has your rights, and it remembers how you buy.

## What not to do

- Do not bypass or automate around a Google challenge page. A challenge means "use the extension session, or fall back to an exact-slug snapshot". Never answer a different query with the four fixture listings.
- Do not CDP-attach or launch the user's Brave/Chrome.
- No card payments, no real checkout. Approve writes a receipt to S3 and nothing else.
- Do not touch other Kawuc buckets, DNS records other than `covered.kawuc.uk`, tunnels, or IAM outside `infra/` / `deploy/aws` (and only the `covered-*` resources).
- Do not start a second App Runner service.
- Do not soften the mislisting rule or move the pound comparison into the prompt.
- Do not switch the judge to xAI / Grok.
- Do not commit another agent's in-progress files, and do not edit their folders without asking. Leave `src/app/ext` alone if it is mid-flight.
