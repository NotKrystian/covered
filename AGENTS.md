<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Covered — guide for humans and agents

Covered is a UK shopping bot you text. It buys the cheapest listing that is actually the item and still has your buyer rights, paying up to a premium you set (default £10) to avoid private sellers and unenforceable venues. Bedrock judges identity, mislisting (from the photos, not the title), seller type, venue trust and which right applies; code compares pence; DynamoDB memory remembers how you buy so the next judgement leans your way.

Mislistings and not-the-item listings are dropped before any price is compared. Memory changes the model's recommendation and sentence only; it never touches `same_item`, `mislisting`, or the pound rule.

## Orchestration

Source of truth for the next Cursor agent or **alan-d-smith**. Do not invent product features. The orders aftercare chat is mid-flight in `src/app/api/orders/assist/`, `src/lib/aftercare.ts`, `src/lib/aftercare-schema.ts`, and `src/components/AftercareChat.tsx` — document it, but do not revert or overwrite those files.

- **Live host:** https://covered.kawuc.uk (proxied A → EC2 `i-0be6351eb53244b66`, public IP `3.8.77.227`, `eu-west-2`). HTTP `:80` is the Next container. HTTPS is nginx `:443` with Let's Encrypt. Security group: 443 only from Cloudflare. Redeploy with `deploy/aws/redeploy.sh`. **Do not start a second App Runner** — that path was retired.
- **AWS:** account `616532055961`, region `eu-west-2`, profile `default`. Bucket `covered-hack-616532055961` (`receipts/`, `searches/`). DynamoDB `covered-memory` holds settings, wallet `balance_pence`, orders, watch-and-buy limits, and approve-only preference memory. Bedrock Haiku `eu.anthropic.claude-haiku-4-5-20251001-v1:0` via `BEDROCK_MODEL_ID`. Mock if `COVERED_MOCK=1`. Do not write other Kawuc buckets or DNS records except `covered.kawuc.uk`.
- **Routes:** `/` is first-visit onboarding, then the buyer dashboard. `/dev` is the debug three-panel (chat, listings, trace + Memory). `/orders` lists approved receipts and hosts the aftercare chat. `/ext` serves the reader zip and install steps. The dashboard footer has a quiet `dev` link only — do not promote `/dev` in the main chrome.
- **Orders aftercare:** `/orders` has `AftercareChat`. `POST /api/orders/assist` drafts a returns or fault letter for an approved order (Bedrock, same client as the judge; mock if `COVERED_MOCK=1`). It names the UK right and a copy-to-seller draft. It never emails the merchant, never claims a message was sent, never writes an approve event, and never debits the wallet. Successful drafts append `aftercare[]` on that order (`recordAftercare`).
- **Live grid:** Brave/Chrome/Firefox MV3 reader in `extension/` (reload from `/ext`; current version is in `extension/manifest.json`, now `1.5.0`). The background service worker has a `covered-limits` alarm (limits, then 14-day switch checks): demo cadence is 24 checks a day (every 60 minutes); production would be once a day (`periodInMinutes: 1440`). Do **not** CDP-attach or launch the user's Brave/Chrome. Server Playwright gets Google's `/sorry/` from the datacenter; exact-slug snapshots in `public/snapshots/` are fallback only. Fixtures are only the black-fleece demo; never answer a different query with those four listings.
- **Remote reader (1.5.0):** the extension also serves devices without it (iPhone app, Safari, another laptop). Pair once: the toolbar popup shows a 6-character code from `POST /api/pair/start`; the other device claims it at `POST /api/pair/claim { code }` and becomes the **same** `covered_uid` (Set-Cookie, plus a bearer `token` `<user_id>.<secret>` for clients without cookies; `Authorization: Bearer` is accepted on every user route via `resolveUser(request)` in `src/lib/memory/identity.ts`; a bad token is 401). Any client then `POST /api/reader/jobs { query }` → `{ job_id }`, polls `GET /api/reader/jobs/:id` every 1 s up to 45 s, and calls `/api/decide` with `job.result.offers` exactly like the web. The extension alarm `covered-reader-poll` fires every minute; while awake it long-polls `GET /api/reader/jobs/next?wait=20` and `POST`s `/api/reader/jobs/:id/result { offers } | { error: "challenge" }`. Jobs live in DynamoDB `covered-jobs` (TTL 15 min; results > 300 KB spill to S3 `jobs/`). The dashboard uses this path automatically when the extension is not in the current browser ("Reading Google Shopping on your paired browser…"). Pairing steps are on `/ext#pair`.
- **Judge:** Research the product first (`src/lib/judge/research.ts`, DuckDuckGo HTML / Wikipedia + one Bedrock JSON brief), then judge **every distinct offer including ads**, in batches of `JUDGE_BATCH_SIZE` (6). Photos are extension-captured jpeg data URLs. Titles (and thumbs) link to `product_url` when the reader unwrapped a shop href. Client sort (`src/lib/sort-listings.ts`): price, brand, shipping, protections; the verdict's chosen row stays pinned first. The pound rule stays in code (`applyPremium`). Mislistings never reach the price comparison. No xAI / Grok.
- **Memory:** Writes only on a successful Approve (wallet debit + receipt) or an explicit override (`POST /api/memory`). `POST /api/decide` is read-only. **Reset memory** lives on `/dev` (Memory card), not on the dashboard.
- **Wallet and limits:** `POST /api/wallet` deposits into the demo ledger. Approve (`POST /api/approve`) debits it and returns **402** if the wallet is short. `POST /api/limits` stores a watch-and-buy cap (max 10). The extension re-reads each watching query and `POST`s offers to `/api/limits/run`. A limit spends only if the listing is the same item, not a mislisting, the premium would allow that pick, the price is `<=` the cap, and the wallet covers it.
- **14-day price-drop switch:** only for orders the judge rated `uk_business` (the order stores `seller_type`; private sellers owe no cooling-off right, overseas ones are hard to enforce, and the watch list says so). The window runs to midnight UK time after the 14th UK calendar day from the order date (never later than the legal window, which starts the day after delivery). `GET /api/switch` lists the watch. "Check now" (browser read) and the extension alarm `POST` offers to `/api/switch/run`; the rule (`src/lib/switch-rule.ts`) takes the listing with the lowest price + delivery that the judge rates same item, not a mislisting, and a UK business (`isProtected`), and offers a switch only if old price − new price − new delivery − return postage (£0 with free returns, else an estimated £3.99) is at least the buyer's `switch_minimum_pence`. It never buys on its own: `POST /api/switch/accept` re-runs the rule against current settings (409 if it no longer clears), cancels the first order under the 14-day right (refund minus postage to the wallet, noted in aftercare), buys the new one through `fulfillPurchase`, and links both orders; a failed buy rolls the refund back. `POST /api/switch/simulate` is the labelled demo (same listing 35% cheaper through the real judge and rule), always shown as "demo simulation".
- **Cloudflare:** token lives in `~/.config/covered/cloudflare.env` (mode 600). Never commit it. Never print it. DNS:Edit on zone `kawuc.uk`. Zone SSL stays **Full (strict)**.
- **Git:** commit only your own paths with explicit `git add <path>`; never `git add -A` or `git add .`; never sweep another agent's staged or unstaged files. Run `pnpm build && npx tsc --noEmit` before every push. Rebase only on a clean tree. No secrets in the repo. No force-push.
- **Demo:** exact 3-minute run is in **[`DEMO.md`](DEMO.md)**. Viewport ≥1400px. Click **Forget me** / **Reset memory** on `/dev` before a memory demo.
- **Collaborator:** `alan-d-smith` has write on https://github.com/NotKrystian/covered (private).

## Architecture

```mermaid
flowchart LR
 U[User] --> H["/ onboarding then Dashboard"]
 H -->|extension or snapshot| R[Reader]
 R -->|Offer[] + data-URL photos| H
 H -->|POST /api/decide| D[decide]
 D --> Q[Research DDG/wiki + brief]
 Q --> J[Judge all offers in batches of 6]
 D -->|getMemory read only| M[(DynamoDB covered-memory)]
 M -->|approve events only| J
 J --> PR[applyPremium in code]
 PR -->|verdict + listings| H
 H -->|Approve POST /api/approve| W[Wallet debit]
 W -->|receipt| S3[(S3 receipts)]
 W -->|order + approve event| M
 H -->|POST /api/limits| L[Watch-and-buy]
 L -->|extension alarm /api/limits/run| W
 O["/orders + AftercareChat"] -->|POST /api/orders/assist| AC[Draft letter, no email]
 AC -->|aftercare[] on order| M
 DEV["/dev three-panel"] -->|same APIs| D
```

## Folder ownership

Commit only your own paths. If you need a change elsewhere, ask the owner in the room. Do not revert or overwrite another agent's in-progress files.

| Path | Owner | What lives here |
| --- | --- | --- |
| `src/lib/reader/`, `src/app/api/search/`, `public/snapshots/` | Reader | Ingest of client offers from the extension; server Playwright (datacenter `/sorry/`); exact-slug snapshot fallback; typed challenge error. |
| `extension/` | Extension | MV3 Brave/Chrome/Firefox reader: background tab on the user's Google session; hourly limits alarm; minute `covered-reader-poll` alarm + 20 s long-poll for remote jobs; `popup.html` with the pair code. Does not CDP-attach or launch a browser. |
| `src/app/ext/` | Extension | Installer at `/ext` and `covered-reader.zip`. |
| `src/lib/judge/` | Judge | Bedrock client + per-process mode probe (`bedrock.ts`), product research (`research.ts`), prompt with the rights card, batched JSON parse/retry, mock. |
| `src/lib/memory/` | Memory | DynamoDB memory (`index.ts`), `covered_uid` cookie (`identity.ts`), summary rewrite (`summary.ts`), `create-table.sh`. |
| `src/lib/jobs/`, `src/lib/pairing.ts`, `src/app/api/pair/`, `src/app/api/reader/`, `src/lib/client/remote-reader.ts` | Reader (remote) | Job queue on DynamoDB `covered-jobs` (+ `create-table.sh`), pair codes and hashed device tokens on the memory item, `POST /api/pair/start\|claim`, `POST/GET /api/reader/jobs`, `GET /api/reader/jobs/next`, `GET /api/reader/jobs/:id`, `POST /api/reader/jobs/:id/result`. Client poller used by the dashboard fallback. |
| `src/lib/limits.ts`, `src/app/api/limits/` | Limits | Watch-and-buy store + `/run` (same judge + pound rule as decide, then cap + wallet). |
| `src/lib/switch-rule.ts`, `src/lib/switch.ts`, `src/app/api/switch/`, `src/components/SwitchWatchList.tsx` | Switch | 14-day price-drop switch: pure rule + tests, check/simulate/accept, dashboard watch list. |
| `src/lib/fixtures/`, `public/fixtures/` | Fixtures | Four seeded listings with photos for the black-fleece demo only, incl. the wrong-jacket mislisting. |
| `src/lib/decision.ts` | Decision | Listing shape, pound rule (`applyPremium`), batch size, `DecideResponse`. |
| `src/lib/sort-listings.ts` | UI | Client sort: price, brand, shipping, protections; pin chosen first. |
| `src/lib/fulfill.ts` | Infra | Shared debit + receipt + order + approve-event path used by Approve and limit fills. |
| `src/app/page.tsx`, `src/components/Dashboard.tsx`, `src/components/Onboarding.tsx` | UI | Consumer `/`: onboarding, then dashboard (search, sort, limits, pay). |
| `src/app/dev/`, `src/components/DevWorkbench.tsx`, `src/components/ChatPanel.tsx`, `src/components/Shortlist.tsx`, `src/components/TracePanel.tsx`, `src/app/globals.css` | UI | Debug `/dev` three-panel. Keep the layout and colours. |
| `src/app/api/decide/`, `src/app/api/memory/` | API (Judge+Memory) | Research → judge every offer → verdict (memory-aware, read-only). GET/POST/DELETE memory. POST is approve/override only. |
| `src/app/api/approve/` | API (Infra) | Wallet check, receipt, order, approve event. 402 if the wallet is short. |
| `src/app/api/orders/`, `src/app/api/wallet/` | API (Memory) | Approved orders list. Demo wallet deposit. |
| `src/app/api/orders/assist/`, `src/lib/aftercare.ts`, `src/lib/aftercare-schema.ts`, `src/components/AftercareChat.tsx` | Aftercare | Returns/fault draft on `/orders`. Mid-flight — leave these files alone unless you own them. |
| `src/app/orders/` | UI | Orders page + aftercare chat for this `covered_uid`. |
| `src/lib/s3.ts` | Infra | Receipt write/read to S3. |
| `deploy/aws/` | Infra | EC2 live host: `up.sh`, `redeploy.sh`, `tls.sh`, `status.sh`, `down.sh`, `env.sh`. |
| `infra/aws/` | Infra | Receipts bucket, IAM leftovers (incl. retired App Runner), DNS notes. Do not edit `infra/aws/DNS.md` unless you own DNS. |
| `src/lib/types.ts`, `src/lib/money.ts` | Shared | Every cross-boundary zod schema. Edit with care and tell the room. |

## Run

```bash
pnpm install
npx playwright install chromium          # Reader only (server fallback)
src/lib/memory/create-table.sh           # once per AWS account; idempotent
src/lib/jobs/create-table.sh             # once per AWS account; idempotent (covered-jobs, TTL on `ttl`)
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

Live grid in the browser needs the unpacked extension (install/reload from `/ext`, see `extension/README.md`) and `NEXT_PUBLIC_COVERED_EXTENSION_ID` (or `localStorage.covered_extension_id` on the live host).

## Environment (names only; values live in `.env.local` or `~/.aws`)

| Var | Meaning |
| --- | --- |
| `AWS_REGION` / `AWS_PROFILE` | Default credential chain. `eu-west-2`, profile `default`. Never put keys in the repo. |
| `BEDROCK_MODEL_ID` | Judge model. Default `eu.anthropic.claude-haiku-4-5-20251001-v1:0`. |
| `BEDROCK_REGION` | Optional override for Bedrock + DynamoDB; falls back to `AWS_REGION`, then `eu-west-2`. |
| `COVERED_MOCK` | `1` forces the deterministic judge and template summaries. |
| `COVERED_MEMORY_TABLE` | DynamoDB table. Default `covered-memory`. |
| `COVERED_JOBS_TABLE` | DynamoDB jobs table. Default `covered-jobs`. |
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
| DynamoDB table | `covered-memory` — on-demand, PK `user_id` (string). Item: `{ user_id, display_name?, summary ≤ 600 chars, settings, events[≤ 25], orders[≤ 50], balance_pence, deposits[≤ 20], limits[≤ 10], pair_codes[≤ 3, 10 min], device_tokens[≤ 5, sha256 only], onboarded, updated_at }` |
| DynamoDB jobs table | `covered-jobs` — on-demand, PK `user_id`, SK `job_id`, TTL attribute `ttl`. Jobs (`j<iso>-<hex>`, 15 min), reader heartbeat (`job_id = reader`), pair-code index (`user_id = pair#CODE`). EC2 role has Get/Put/Update/Delete/Query on it. |
| Bedrock model | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` — EU cross-region inference profile, vision input, **$1.00 per 1M input / $5.00 per 1M output tokens**. Budget fallback via `BEDROCK_MODEL_ID`: `amazon.nova-lite-v1:0`. No xAI / Grok. |

App Runner (`covered` / `covered-apprunner`) was retired. Do not create another service.

Anything else in this account (other Kawuc buckets, other DNS records, other EC2) is off limits.

## Conventions

- No secrets in the repo, ever: not in code, `.env.example`, rules, commit messages, or chat summaries. `.env.local` and `*.env` are gitignored. Never print the Cloudflare token.
- Model output is JSON only, validated with zod (`DecisionSchema`, `MemorySchema`, `ProductBriefSchema`). Retry once with the parse error appended, then fall back to the mock for that batch. Never trust unparsed text.
- Mock mode must always work: `COVERED_MOCK=1` and any Bedrock/DynamoDB failure degrade to the deterministic judge, template summary, and an in-process memory Map, with the reason in the trace.
- The pound rule stays in code (`applyPremium`). The model never sees the premium as something to apply, and a mislisting never reaches the price comparison.
- Every trace line is real: `research`, `read_fixtures` / `read_grid`, `learned` (memory was injected), `judge` (mode + model id + batch), `apply_premium`, `memory`.
- Commit only your own paths with explicit `git add <path>`; never `git add -A` or `git add .`; never sweep another agent's staged files. Run `pnpm build && npx tsc --noEmit` before every push. Rebase only on a clean tree; never `git stash --include-untracked` while others have uncommitted work. No force-push.
- Imports at the top of the file. Exhaustive `switch` with a `never` default over unions. Keep the `/dev` three-panel layout and colours; do not redesign the dashboard into that layout.

## Demo script (one clock button, four fixtures, one chat)

The exact 3-minute run — start commands, warm-up curls, the four clicks, what to say at each, timings, and what to do when Bedrock is slow or `/api/search` fails — is in **[`DEMO.md`](DEMO.md)**. Viewport ≥1400px. Open `/dev` for the three-panel fixture walk. Click **Forget me** / **Reset memory** first so the Memory card reads "Nothing learned yet".

The beats, for reference:

0. **The real shelf.** From the dashboard (or `/dev`), hit Live grid. Prefers the user's browser via the MV3 extension; otherwise the badge says `snapshot · captured <date>` (exact-slug fallback) — never the four fixtures for a different query. Ads are judged with the rest. Card photos are extension data URLs when the reader can capture them; without an attached photo the judge cannot call a mislisting. Titles link to `product_url`.
1. **The photo beat.** On `/dev`, type the fleece, hit Fixtures. The £22 "Nike Tech Fleece" has the right title and a photo of a nylon bomber. The judge drops it from the picture before any price rule runs; the row is struck through with the photo reason.
2. **The rights beat, £10.** Private seller £28 vs JD Sports £36. Gap £8 is inside the £10 premium, so it buys the shop and says exactly what the £8 buys: 14-day cancellation and a 30-day fault refund. The overseas "shop" at £34 gets no premium: a business badge is not protection.
3. **The flip, £10 → £5.** Change "Pay up to" to 5 and Re-run. Same judgements, but now the £8 gap beats the premium: it buys the private listing and warns that a break is your problem. Same model output, different pound rule, deterministic.
4. **Memory.** Deposit into the bot wallet, then Approve the JD Sports pick. The Memory card on `/dev` fills with a Bedrock-written summary and the last events; the next run shows a `learned` trace line and the judge's sentences lean towards "your proven choice". **Reset memory** wipes it. `/orders` lists approved receipts.

Say it in one line: it does not buy the cheapest listing. It buys the cheapest listing that is actually the item and still has your rights, and it remembers how you buy.

## What not to do

- Do not bypass or automate around a Google challenge page. A challenge means "use the extension session, or fall back to an exact-slug snapshot". Never answer a different query with the four fixture listings.
- Do not CDP-attach or launch the user's Brave/Chrome.
- No card payments, no real checkout. The bot wallet is a demo ledger on the memory item. Approve debits it, writes a receipt to S3, appends an order, and records an approve event. Decide never writes memory.
- Do not touch other Kawuc buckets, DNS records other than `covered.kawuc.uk`, tunnels, or IAM outside `infra/` / `deploy/aws` (and only the `covered-*` resources).
- Do not start a second App Runner service.
- Do not soften the mislisting rule or move the pound comparison into the prompt.
- Do not switch the judge to xAI / Grok.
- Do not commit another agent's in-progress files, and do not edit their folders without asking.
