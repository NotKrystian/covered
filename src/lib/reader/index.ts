/**
 * Browser reader — owned by the Reader agent.
 *
 * Opens `https://www.google.com/search?q=QUERY&udm=28&hl=en&gl=uk` in Playwright
 * Chromium, waits for `product-viewer-entrypoint` or `div.mnr-c.pla-unit`, reads the
 * first paint (both the sponsored row and the browse grid), maps into `Offer`, dedupes,
 * and returns a `ReaderResponse`. On a challenge page it returns
 * `{ ok: false, error: { kind: "challenge" } }`. No bypass, no paging.
 */
import type { Page } from "playwright";
import type { Offer, ReaderError, ReaderResponse, SearchResult } from "@/lib/types";
import { normalizeOfferPrice } from "@/lib/price-kind";
import { evaluateInPage, newPage, readerMode } from "./browser";
import { acceptConsentOnce, classifyPage } from "./challenge";
import { dedupeBrowse, dedupeSponsored } from "./dedupe";
import { extractGrid, type GridExtraction, type SelectorHits } from "./extract";
import { MAX_PER_SECTION } from "./limits";
import { findSnapshot, slugify } from "./snapshots";
import { hydrateOfferPhotos } from "./photos";

export type { ReaderResponse, ReaderError, SearchResult, Offer } from "@/lib/types";
export { closeBrowser, readerMode, cdpUrl, type ReaderMode } from "./browser";
export { MAX_PER_SECTION } from "./limits";
export { slugify, findSnapshot, listSnapshotSlugs } from "./snapshots";

/** How long we wait for either card selector before classifying the page. */
const CARDS_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const POLL_MS = 250;
/** After the first card appears, let the paint settle until the counts stop moving. */
const SETTLE_MAX_MS = 2_500;
const SETTLE_STABLE_ROUNDS = 3;

export function gridUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=28&hl=en&gl=uk`;
}

function fail(kind: ReaderError["kind"], message: string): ReaderResponse {
  return { ok: false, error: { kind, message } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatHits(hits: SelectorHits): string {
  const units = hits.units ?? 0;
  return Object.entries(hits)
    .filter(([key]) => key !== "units")
    .map(([key, count]) => `${key}=${count}/${units}`)
    .join(" ");
}

function logHits(query: string, extraction: GridExtraction): void {
  const { sponsored, browse } = extraction.hits;
  console.log(`[reader] "${query}" sponsored units=${sponsored.units ?? 0} ${formatHits(sponsored)}`);
  console.log(`[reader] "${query}" browse units=${browse.units ?? 0} ${formatHits(browse)}`);
  if (extraction.more_results_href) {
    console.log(`[reader] "${query}" more-results link present (not followed)`);
  }
}

function withPence(offer: Offer): Offer {
  return normalizeOfferPrice(offer);
}

type WaitOutcome =
  | { kind: "cards" }
  | { kind: "challenge"; reason: string }
  | { kind: "timeout"; lastState: string };

/**
 * Poll until cards exist, a challenge is detected, or the budget runs out.
 * Clicks the consent dialog once if it shows up; nothing else is clicked.
 */
async function waitForCardsOrChallenge(page: Page): Promise<WaitOutcome> {
  const deadline = Date.now() + CARDS_TIMEOUT_MS;
  let consentClicked = false;
  let lastState = "empty";
  while (Date.now() < deadline) {
    const state = await classifyPage(page).catch(() => null);
    if (state) {
      lastState = state.kind;
      if (state.kind === "cards") return { kind: "cards" };
      if (state.kind === "challenge") return { kind: "challenge", reason: state.reason };
      if (state.kind === "consent") {
        if (consentClicked) return { kind: "challenge", reason: "consent dialog persisted after one click" };
        consentClicked = await acceptConsentOnce(page);
        if (consentClicked) {
          console.log("[reader] consent dialog accepted once");
          await page.waitForLoadState("domcontentloaded").catch(() => undefined);
        }
      }
    }
    await sleep(POLL_MS);
  }
  return { kind: "timeout", lastState };
}

/** Let the first paint finish drawing without scrolling or clicking anything. */
async function settle(page: Page): Promise<void> {
  const deadline = Date.now() + SETTLE_MAX_MS;
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline && stable < SETTLE_STABLE_ROUNDS) {
    const count = await page
      .evaluate(
        () =>
          document.querySelectorAll("div.mnr-c.pla-unit").length +
          document.querySelectorAll("product-viewer-entrypoint").length,
      )
      .catch(() => last);
    stable = count === last ? stable + 1 : 0;
    last = count;
    await sleep(POLL_MS);
  }
}

/** `COVERED_READER_DISABLED=1` skips the browser entirely (e.g. a container with no Chromium). */
export function readerDisabled(): boolean {
  return process.env.COVERED_READER_DISABLED === "1";
}

/**
 * Read the Shopping grid for `query`: live first, snapshot second.
 *
 * Any failed live read (challenge, timeout, no_offers, unknown — including a
 * missing Chromium) falls back to `public/snapshots/<slug>.json` only when the
 * slug matches the query exactly. The snapshot result carries `source:
 * "snapshot"` and `fallback_from` with the live error. A close-but-wrong
 * snapshot is never served. Only when no exact snapshot exists does the
 * original error come back.
 */
export async function readGrid(query: string): Promise<ReaderResponse> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return fail("unknown", "query is empty");

  let liveError: ReaderError;
  if (readerDisabled()) {
    console.log(`[reader] "${trimmed}" path=disabled (COVERED_READER_DISABLED=1), going straight to snapshots`);
    liveError = { kind: "unknown", message: "live reader disabled by COVERED_READER_DISABLED=1" };
  } else {
    const live = await readGridLive(trimmed);
    if (live.ok) {
      console.log(`[reader] "${trimmed}" path=live offers=${live.result.offers.length}`);
      return live;
    }
    liveError = live.error;
    console.log(`[reader] "${trimmed}" path=live failed (${liveError.kind}): ${liveError.message}`);
  }

  const match = await findSnapshot(trimmed);
  if (!match) {
    console.log(`[reader] "${trimmed}" path=snapshot none matched (slug=${slugify(trimmed)})`);
    return { ok: false, error: liveError };
  }
  console.log(`[reader] "${trimmed}" path=snapshot exact slug=${match.slug} offers=${match.result.offers.length}`);
  return {
    ok: true,
    result: { ...match.result, query: trimmed, source: "snapshot", fallback_from: liveError },
  };
}

/**
 * Read the first paint of the Shopping grid for `query` from a real browser.
 * Never throws for expected outcomes; returns a typed `ReaderResponse`.
 */
export async function readGridLive(query: string): Promise<ReaderResponse> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return fail("unknown", "query is empty");

  const mode = readerMode();
  let page: Page;
  try {
    page = await newPage();
  } catch (err) {
    return fail("unknown", `could not open browser (mode=${mode}): ${errorMessage(err)}`);
  }
  console.log(`[reader] "${trimmed}" mode=${mode}`);

  try {
    const url = gridUrl(trimmed);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (err) {
      if (isTimeoutError(err)) return fail("timeout", `navigation timed out after ${NAVIGATION_TIMEOUT_MS}ms`);
      return fail("unknown", `navigation failed: ${errorMessage(err)}`);
    }

    const outcome = await waitForCardsOrChallenge(page);
    if (outcome.kind === "challenge") {
      console.log(`[reader] "${trimmed}" challenge: ${outcome.reason} (${page.url()})`);
      return fail("challenge", `Google served a challenge/consent page: ${outcome.reason}`);
    }
    if (outcome.kind === "timeout") {
      // No cards in budget. A loaded, quiet page with no cards is `no_offers`.
      const state = await classifyPage(page).catch(() => null);
      if (state?.kind === "challenge") return fail("challenge", state.reason);
      if (state?.kind === "empty") {
        const loaded = await page.evaluate(() => document.readyState).catch(() => "unknown");
        if (loaded === "complete") {
          return fail("no_offers", "page loaded but no sponsored or browse cards were drawn");
        }
      }
      return fail("timeout", `no cards after ${CARDS_TIMEOUT_MS}ms (last state: ${outcome.lastState})`);
    }

    await settle(page);

    const extraction = await evaluateInPage(page, extractGrid);
    logHits(trimmed, extraction);

    const sponsored = dedupeSponsored(extraction.sponsored.map(withPence)).slice(0, MAX_PER_SECTION);
    const browse = dedupeBrowse(extraction.browse.map(withPence)).slice(0, MAX_PER_SECTION);
    console.log(
      `[reader] "${trimmed}" raw sponsored=${extraction.sponsored.length} browse=${extraction.browse.length} -> deduped sponsored=${sponsored.length} browse=${browse.length}`,
    );

    if (sponsored.length === 0 && browse.length === 0) {
      return fail("no_offers", "cards were present but no offer could be mapped");
    }

    const result: SearchResult = {
      query: trimmed,
      fetched_at: new Date().toISOString(),
      source: "live",
      offers: await hydrateOfferPhotos([...sponsored, ...browse]),
    };
    return { ok: true, result };
  } catch (err) {
    if (isTimeoutError(err)) return fail("timeout", errorMessage(err));
    const message = errorMessage(err);
    if (mode === "cdp" && /has been closed|ECONNREFUSED|disconnected/i.test(message)) {
      return fail("unknown", `${message} (the attached browser went away; rerun scripts/chrome-debug.sh)`);
    }
    return fail("unknown", message);
  } finally {
    await page.close().catch(() => undefined);
  }
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || /timeout/i.test(err.message));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
