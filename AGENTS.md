<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Covered — guide for humans and agents

Covered is a UK shopping bot you text. It buys the cheapest listing that is actually the item and still has your buyer rights, paying up to a premium you set (default £10) to avoid private sellers and unenforceable venues. A model on Amazon Bedrock judges identity, mislisting (from the photos, not the title), seller type, venue trust and which right applies; a few lines of code compare pence, and a small DynamoDB memory remembers how you buy so the next judgement leans your way.

## Architecture

```mermaid
flowchart LR
  U[User in chat] -->|query + settings| P[page.tsx]
  P -->|POST /api/search| R[Reader<br/>Playwright / CDP read of Google Shopping udm=28<br/>or snapshot / fixtures]
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

Mislistings and not-the-item listings are dropped before any price is compared. Memory changes the model's recommendation and sentence only; it never touches `same_item`, `mislisting`, or the pound rule.

## Folder ownership

Commit only your own paths. If you need a change elsewhere, ask the owner in the room.

| Path | Owner | What lives here |
| --- | --- | --- |
| `src/lib/judge/` | Judge+Memory | Bedrock client + per-process mode probe (`bedrock.ts`), prompt with the rights card, JSON parse/retry, mock. |
| `src/lib/memory/` | Judge+Memory | DynamoDB memory (`index.ts`), `covered_uid` cookie (`identity.ts`), summary rewrite (`summary.ts`), `create-table.sh`. |
| `src/app/api/decide/`, `src/app/api/memory/` | Judge+Memory | Shortlist → verdict (memory-aware). GET/POST/DELETE memory. |
| `src/app/page.tsx`, `src/components/`, `src/app/globals.css` | Judge+Memory | Three-panel UI: chat, shortlist, trace + Memory card. |
| `src/lib/fixtures/`, `public/fixtures/` | Judge+Memory | Four seeded listings with photos, incl. the wrong-jacket mislisting. |
| `src/lib/decision.ts` | Judge+Memory | Shortlist shape, pound rule, `DecideResponse`. |
| `src/lib/reader/`, `src/app/api/search/`, `public/snapshots/` | Reader | Playwright/CDP read of the Shopping grid, typed challenge error, saved snapshots. |
| `src/lib/s3.ts`, `src/app/api/approve/` | Infra | Receipt write/read to S3. |
| `infra/`, `scripts/`, `Dockerfile`, `deploy/`, README "Run / Deploy" | Infra | Bucket, IAM, deploy, Cloudflare tunnel, DNS. |
| `src/lib/types.ts`, `src/lib/money.ts` | Shared | Every cross-boundary zod schema. Edit with care and tell the room. |

## Run

```bash
pnpm install
npx playwright install chromium          # Reader only
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

## Environment (names only; values live in `.env.local` or `~/.aws`)

| Var | Meaning |
| --- | --- |
| `AWS_REGION` / `AWS_PROFILE` | Default credential chain. `eu-west-2`, profile `default`. Never put keys in the repo. |
| `BEDROCK_MODEL_ID` | Judge model. Default `eu.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| `BEDROCK_REGION` | Optional override for Bedrock + DynamoDB; falls back to `AWS_REGION`, then `eu-west-2`. |
| `COVERED_MOCK` | `1` forces the deterministic judge and template summaries. |
| `COVERED_MEMORY_TABLE` | DynamoDB table. Default `covered-memory`. |
| `S3_BUCKET` | Receipts bucket. |
| `COVERED_READER_CDP` | Reader: attach to your own Chrome at `http://127.0.0.1:9222`. |
| `NEXT_PUBLIC_APP_NAME` | `Covered`. |

## AWS resources

| Resource | Value |
| --- | --- |
| Account | `616532055961` |
| Region | `eu-west-2` (London) |
| S3 bucket | `covered-hack-616532055961` — receipts at `receipts/{id}.json`, snapshots at `searches/{slug}/{iso}.json` |
| DynamoDB table | `covered-memory` — on-demand, PK `user_id` (string). Item: `{ user_id, display_name?, summary ≤ 600 chars, settings, events[≤ 25], updated_at }` |
| Bedrock model | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` — EU cross-region inference profile, vision input, **$1.00 per 1M input / $5.00 per 1M output tokens**. Chosen over Sonnet 4.6 ($3/$15) as the cheapest strong vision model reachable from London via an `eu.` profile; `amazon.nova-lite-v1:0` ($0.084/$0.336 in London) is the budget fallback via `BEDROCK_MODEL_ID` but reasons less well about seller and venue. Probe: `Converse` with a bomber-jacket photo answered `{"garment":"bomber jacket","is_fleece":false}` in ~1.2 s. |

Anything else in this account (other Kawuc buckets, DNS zones, EC2) is off limits.

## Conventions

- No secrets in the repo, ever: not in code, `.env.example`, rules, commit messages, or chat summaries. `.env.local` and `*.env` are gitignored.
- Model output is JSON only, validated with zod (`DecisionSchema`, `MemorySchema`). Retry once with the parse error appended, then fall back to the mock for that item. Never trust unparsed text.
- Mock mode must always work: `COVERED_MOCK=1` and any Bedrock/DynamoDB failure degrade to the deterministic judge, template summary, and an in-process memory Map, with the reason in the trace.
- The pound rule stays in code (`applyPremium`). The model never sees the premium as something to apply, and a mislisting never reaches the price comparison.
- Every trace line is real: `read_fixtures` / `read_grid`, `learned` (memory was injected), `judge` (mode + model id), `apply_premium`, `memory`.
- Commit only your own paths with explicit `git add <path>`; never `git add -A` or `git add .`. Run `pnpm build` and `npx tsc --noEmit` before every push. Rebase only on a clean tree; never `git stash --include-untracked` while others have uncommitted work.
- Imports at the top of the file. Exhaustive `switch` with a `never` default over unions. Keep the three-panel layout and colours; do not redesign.

## Demo script (one clock button, four fixtures, one chat)

The exact 3-minute run — start commands, warm-up curls, the four clicks, what to say at each, timings, and what to do when Bedrock is slow or `/api/search` fails — is in **[`DEMO.md`](DEMO.md)**. The beats, for reference:

0. **The real shelf.** Hit Live grid. The badge over the shortlist says `live`, `snapshot · captured <date>` (a real Google Shopping grid saved when headless Chromium got Google's challenge page) or `fixtures`. Ads carry an `Ad` chip and their merchant domain; browse rows show their returns line. Twelve rows (at most 4 ads, browse rows with a returns line first) go to the judge with no photos, so it is told it cannot call a mislisting.
1. **The photo beat.** Type the fleece, hit Fixtures. The £22 "Nike Tech Fleece" has the right title and a photo of a nylon bomber. The judge drops it from the picture before any price rule runs; the row is struck through with the photo reason.
2. **The rights beat, £10.** Private seller £28 vs JD Sports £36. Gap £8 is inside the £10 premium, so it buys the shop and says exactly what the £8 buys: 14-day cancellation and a 30-day fault refund. The overseas "shop" at £34 gets no premium: a business badge is not protection.
3. **The flip, £10 → £5.** Change "Pay up to" to 5 and Re-run. Same judgements, but now the £8 gap beats the premium: it buys the private listing and warns that a break is your problem. Same model output, different pound rule, deterministic.
4. **Memory.** Approve the JD Sports pick. The Memory card fills with a Bedrock-written summary and the last events; the next run shows a `learned` trace line and the judge's sentences lean towards "your proven choice". "Forget me" wipes it.

Say it in one line: it does not buy the cheapest listing. It buys the cheapest listing that is actually the item and still has your rights, and it remembers how you buy.

## What not to do

- Do not bypass or automate around a Google challenge page. A challenge means "switch to fixtures or a saved snapshot".
- No card payments, no real checkout. Approve writes a receipt to S3 and nothing else.
- Do not touch other Kawuc buckets, DNS records, tunnels, or IAM outside `infra/` (Infra owns those, and only the `covered-*` resources).
- Do not soften the mislisting rule or move the pound comparison into the prompt.
- Do not commit another agent's in-progress files, and do not edit their folders without asking.
