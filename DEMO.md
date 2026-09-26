# Covered — the 3-minute demo

One query, four clicks, one chat. Everything below was run end to end on 26 Sep 2026 against Bedrock (Haiku 4.5, `eu-west-2`), DynamoDB `covered-memory` and S3 `covered-hack-616532055961`.

## Before you walk on (5 minutes earlier)

```bash
cd SpaceXAIHack
git pull --ff-only
pnpm install
PORT=3000 pnpm dev            # or scripts/demo.sh for the public tunnel URL
```

Open `http://localhost:3000` in a browser window at least 1400 px wide (the three panels need the room). Then warm the process and check the wiring in a second terminal:

```bash
# 1. Judge probe + fixtures (≈ 8 s). Expect mode "bedrock" and chosen "shop-36".
curl -s localhost:3000/api/decide -H 'content-type: application/json' \
  -d '{"query":"black fleece jacket medium","source":"fixture"}' | jq '{mode, chosen: .verdict.chosen_id}'

# 2. Reader. Expect source "snapshot" (Google challenges headless Chromium on most networks) or "live".
curl -s localhost:3000/api/search -H 'content-type: application/json' \
  -d '{"query":"black fleece jacket medium"}' | jq '{ok, source: .result.source, n: (.result.offers|length)}'
```

In the app, click **Reset memory** (bottom right) so the Memory card reads "Nothing learned yet". Leave **Pay up to** at 25% and the query at `black fleece jacket medium`.

## The run

Say the line, click, wait for the chat bubble, point at what changed. Each judge call is 7–10 s; talk through it.

### 0. Frame it (10 s)

> "Covered is a shopping bot you text. It does not buy the cheapest listing. It buys the cheapest listing that is actually the item and still has your UK buyer rights, and it remembers how you buy."

### 1. Live grid — the real shelf (45 s)

Click **Live grid**.

> "That is the real Google Shopping grid for a black fleece, 79 offers. The badge over the shortlist says exactly where it came from: `snapshot · captured <today>` because Google challenges headless browsers, or `live` when it got through. No pretending."

Point at: the badge over the shortlist; the **Ad** chips with the merchant domain under the merchant (workwear ads, no returns line); the browse rows with `30-day returns` / `Free 365-day returns`; the Trace panel: `read_grid → 79 offers → 12 shortlisted (4 ads marked, no photos)` then `judge → bedrock … took ~9000 ms`.

> "Twelve rows go to the judge on Bedrock. No photos here, so it is told it cannot call a mislisting; it judges who the seller is and which right applies. Amazon.co.uk at £7.98 is the cheapest, it is the item, and it is a UK shop checkout, so no premium is needed. The ads are marked, never preferred."

### 2. The photo beat — fixtures at 25% (40 s)

Click **Fixtures**.

> "Now four listings with photos. The £22 one has the perfect title, Nike Tech Fleece, and a photo of a nylon bomber. The judge drops it from the photo before any price rule runs."

Point at: the struck-through first row with the red `Mislisting:` line.

> "Then the rights beat. Private seller on Facebook at £28 against JD Sports at £36. That is 22% off the shop, inside my 25%, so it buys the shop and says what the 22% buys: 14-day cancellation and a 30-day fault refund. The overseas stall at £34 gets nothing: a business badge is not protection."

Point at: JD Sports row glowing green, the chat bubble.

### 3. The flip — 25% → 15% (30 s)

Change **Pay up to** to `15`. The winner flips without a new judge call.

> "Same photos, same judgements. Only my number changed. Now 22% is past my 15%, so it buys the private listing and tells me plainly: a fault is my problem. The model never sees the premium as something to apply; a few lines of code compare the percent."

Point at: the red chat bubble, `apply_premium → 15% → private-28` in the trace if you Re-run.

Set **Pay up to** back to `25`.

### 4. Memory (30 s)

Click **Re-run** (fixtures, 25%, JD Sports chosen again), then **Approve** in the chat.

> "Approve writes a receipt to S3, nothing else — no card, no checkout. And it teaches the memory: the card fills with a summary Bedrock wrote about how I buy."

Point at: the receipt line in the chat, the Memory card summary and the `approve shop-36` event.

Click **Re-run** once more.

> "Next run, the trace shows `learned`, and the judge's sentences lean towards my proven choice. The percent premium never reads memory; it only shapes the words and the lean."

Point at: `learned →` in the trace (bold), the JD Sports reason mentioning the past approval.

Click **Reset memory**.

> "And it forgets on request."

### Close (10 s)

> "Cheapest listing that is actually the item, that still has your rights, and it remembers how you buy. That is Covered."

## If something goes wrong

| Symptom | What to do |
| --- | --- |
| Trace pill says **mock** instead of **bedrock** | Bedrock credentials or model access failed at process start; the probe is cached per process. Say "deterministic judge" and carry on: every beat still works (the mock knows the fixtures). Fix between runs: check `aws sts get-caller-identity`, then restart `pnpm dev`. |
| Judge takes > 15 s | Bedrock is slow, not broken; keep talking. If it happens twice, restart with `COVERED_MOCK=1 pnpm dev` for the fixtures beats and say so. Never switch the model live. |
| `/api/search` returns an error / chat says "Live grid unavailable … Using the fixtures instead" | No live read and no matching snapshot. Type the query exactly as `black fleece jacket medium` (the snapshot slug must match, or share two words) and click **Live grid** again. If it still fails, run beats 2–4 on **Fixtures** and say the live grid is snapshot-only on this network. |
| Badge says `snapshot` | That is the expected outcome on most hackathon networks. Say it: "real grid, captured today; Google challenges headless browsers and we do not bypass that". |
| Approve says "Approve failed (502 …)" | S3 write failed (credentials or bucket). Say the receipt is the only side effect and skip to **Re-run**; memory still records from the decide call. |
| Memory pill says **local** | DynamoDB unreachable; memory lives in the server process for this run. Every beat still works; just do not restart the server mid-demo. |
| Verdict says "Nothing to buy" | The model marked every row as not the item. Click **Re-run**; temperature is 0.2 and this has not reproduced in testing. |

## Numbers from the QA run (26 Sep 2026, laptop, London)

| Call | Time |
| --- | --- |
| `/api/search` (challenge → snapshot fallback) | 1.4 s |
| `/api/decide` live, 12 rows, no photos, Bedrock | 9.6–10.6 s total (8.7–9.6 s in Bedrock) |
| `/api/decide` fixtures, 4 rows, 4 photos, Bedrock | 7.0–8.6 s total (6.9–8.5 s in Bedrock) |
| `/api/approve` → S3 | 0.3 s |
| `/api/memory` approve + Bedrock summary rewrite | 1.6 s |
