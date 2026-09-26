/**
 * Playwright lifecycle for the reader. Two modes, picked from the environment:
 *
 * - **headless** (default): one persistent Chromium context per process, profile
 *   under the OS temp dir (outside the repo) so a consent choice sticks.
 *   `COVERED_READER_HEADED=1` shows the window for debugging.
 * - **cdp**: `COVERED_READER_CDP=http://127.0.0.1:9222` attaches to a Chrome the
 *   user already runs (see `scripts/chrome-debug.sh`) via `connectOverCDP` and
 *   opens pages in its default context. Google is far more likely to draw the
 *   grid for a real, signed-in profile. This attaches to the user's own session;
 *   challenge detection is unchanged and nothing is bypassed.
 *
 * Either way the connection is a lazy singleton, pages are opened per read and
 * closed by the caller, and `closeBrowser()` never kills the user's browser.
 */
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export const READER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const READER_VIEWPORT = { width: 1280, height: 900 } as const;

export type ReaderMode = "headless" | "headed" | "cdp";

/** CDP endpoint from the environment, or null when not in CDP mode. */
export function cdpUrl(): string | null {
  const value = process.env.COVERED_READER_CDP?.trim();
  return value && value.length > 0 ? value : null;
}

/** Which browser mode the next read will use. Read from env each call. */
export function readerMode(): ReaderMode {
  if (cdpUrl()) return "cdp";
  return process.env.COVERED_READER_HEADED === "1" ? "headed" : "headless";
}

/** Persistent profile dir for headless mode. Outside the repo so a consent cookie can stick. */
export function profileDir(): string {
  return path.join(os.tmpdir(), "covered-reader-profile");
}

type ReaderGlobal = typeof globalThis & {
  __coveredReaderContext?: Promise<BrowserContext> | undefined;
  __coveredReaderCdp?: { url: string; browser: Promise<Browser> } | undefined;
  __coveredReaderPages?: Set<Page> | undefined;
};

/** Survives Next dev HMR module reloads so we do not leak a Chromium per edit. */
const g = globalThis as ReaderGlobal;

/** Pages this process opened. In CDP mode these are the only things we may close. */
function ourPages(): Set<Page> {
  if (!g.__coveredReaderPages) g.__coveredReaderPages = new Set<Page>();
  return g.__coveredReaderPages;
}

function track(page: Page): Page {
  const pages = ourPages();
  pages.add(page);
  page.on("close", () => pages.delete(page));
  return page;
}

// ---- headless / headed ----------------------------------------------------

async function launch(): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(profileDir(), {
    headless: readerMode() !== "headed",
    locale: "en-GB",
    timezoneId: "Europe/London",
    viewport: { ...READER_VIEWPORT },
    userAgent: READER_USER_AGENT,
    acceptDownloads: false,
  });
  context.on("close", () => {
    g.__coveredReaderContext = undefined;
  });
  return context;
}

/** Lazily launch (or reuse) the shared persistent context (headless mode). */
export function getContext(): Promise<BrowserContext> {
  if (!g.__coveredReaderContext) {
    g.__coveredReaderContext = launch().catch((err: unknown) => {
      g.__coveredReaderContext = undefined;
      throw err;
    });
  }
  return g.__coveredReaderContext;
}

// ---- cdp ------------------------------------------------------------------

async function connect(url: string): Promise<Browser> {
  const browser = await chromium.connectOverCDP(url, { timeout: 10_000 });
  browser.on("disconnected", () => {
    if (g.__coveredReaderCdp?.url === url) g.__coveredReaderCdp = undefined;
  });
  return browser;
}

/** Lazily connect (or reuse) the CDP attachment. Reconnects after a disconnect. */
export function getCdpBrowser(url: string): Promise<Browser> {
  const cached = g.__coveredReaderCdp;
  if (cached && cached.url === url) return cached.browser;
  const browser = connect(url).catch((err: unknown) => {
    if (g.__coveredReaderCdp?.url === url) g.__coveredReaderCdp = undefined;
    throw err;
  });
  g.__coveredReaderCdp = { url, browser };
  return browser;
}

async function newCdpPage(url: string): Promise<Page> {
  const browser = await getCdpBrowser(url);
  // The user's real profile lives in the default context. Never create a fresh one here.
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  await page.setViewportSize({ ...READER_VIEWPORT }).catch(() => undefined);
  return page;
}

// ---- shared ---------------------------------------------------------------

/** Open a fresh page in the current mode. Caller must `page.close()`. */
export async function newPage(): Promise<Page> {
  const cdp = cdpUrl();
  if (cdp) return track(await newCdpPage(cdp));
  const context = await getContext();
  return track(await context.newPage());
}

/**
 * Run a self-contained function in the page.
 *
 * esbuild-based runners (tsx) rewrite nested `const f = () => {}` into
 * `__name(f, "f")` calls, and Playwright ships the function by `toString()`, so
 * the page would throw `__name is not defined`. Install an identity shim first.
 * SWC (Next) does not need it; the shim is a harmless no-op there.
 */
export async function evaluateInPage<T>(page: Page, fn: () => T): Promise<T> {
  await page.evaluate("globalThis.__name = globalThis.__name || function (fn) { return fn; };");
  return page.evaluate(fn);
}

/**
 * Release what this process owns. Used by the CLI so it can exit.
 * Headless: closes our persistent context. CDP: closes only the pages we
 * opened and drops the connection; the user's Chrome keeps running.
 */
export async function closeBrowser(): Promise<void> {
  for (const page of Array.from(ourPages())) {
    await page.close().catch(() => undefined);
  }
  ourPages().clear();

  const cdp = g.__coveredReaderCdp;
  g.__coveredReaderCdp = undefined;
  if (cdp) {
    try {
      const browser = await cdp.browser;
      // For a connectOverCDP browser this only disconnects; it does not quit Chrome.
      await browser.close();
    } catch {
      // Never connected or already gone.
    }
  }

  const pending = g.__coveredReaderContext;
  g.__coveredReaderContext = undefined;
  if (!pending) return;
  try {
    const context = await pending;
    await context.close();
  } catch {
    // Already closed or never launched; nothing to release.
  }
}
