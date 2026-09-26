# Covered

A shopping bot you text. It buys now, or it waits for your price. It will pay more when the cheaper listing is a private seller or an untrustworthy venue, because those listings do not come with UK buyer rights.

Grok decides the things a sort cannot: same item or not (from the photos, not the title), mislisting, business or private seller, trustworthy venue, which right applies. Code only compares pounds to the numbers you set.

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
| `XAI_API_KEY` | xAI key. OpenAI-compatible at `https://api.x.ai/v1`. |
| `AWS_REGION` | `eu-west-2` (London). |
| `AWS_PROFILE` | `default`. The SDK reads `~/.aws`; keys never enter the repo. |
| `S3_BUCKET` | `covered-hack-616532055961`. New bucket only; never an existing Kawuc bucket. |
| `NEXT_PUBLIC_APP_NAME` | `Covered`. |

## Shared contract

`src/lib/types.ts` holds every cross-boundary shape as a zod schema plus inferred type: `Offer`, `SearchResult`, `ReaderResponse`, `Listing`, `Decision`, `Verdict`, `Receipt`, `UserSettings`. `src/lib/money.ts` has `parsePricePence` / `formatPence`. Change these in one place and tell the room.

## Ownership

| Path | Owner | What goes here |
| --- | --- | --- |
| `src/app/page.tsx`, `src/components/` | Decision+UI | Chat, shortlist, sponsored marked as ads, Grok's sentence, Approve. |
| `src/lib/grok/` | Decision+UI | xAI call, prompt, `Verdict` parsing. Pound rule in code. |
| `src/lib/fixtures/` | Decision+UI | Four seeded `Listing`s with real photos, incl. the wrong-jacket mislisting. |
| `src/app/api/decide/` | Decision+UI | Shortlist in, `Verdict` out. |
| `src/lib/reader/` | Reader | Playwright read of the `udm=28` first paint, both lists, deduped, typed challenge error. |
| `src/app/api/search/` | Reader | Query in, `ReaderResponse` out. |
| `src/lib/s3.ts` | Infra | `receipts/{id}.json` PutObject to the new bucket. |
| `src/app/api/approve/` | Infra | `Receipt` in, S3 key out. |
| `infra/`, `scripts/` | Infra | Bucket creation, deploy, tunnel scripts. |
| `src/lib/types.ts`, `src/lib/money.ts` | Shared | Edit with care; everyone imports these. |

## Out of scope today

Paging through `start=10`, challenge bypass, limit watcher, 14-day clock, fault refund, new EC2/CloudFront, any write to an existing Kawuc bucket.
