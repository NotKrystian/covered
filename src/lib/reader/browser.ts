/**
 * Playwright lifecycle for the reader.
 *
 * One persistent Chromium context per process (lazy singleton), so a consent
 * choice sticks between runs and requests do not pay the launch cost twice.
 * Pages are opened per read and closed by the caller.
 *
 * The profile lives under the OS temp dir, outside the repo.
 */
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

export const READER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const READER_VIEWPORT = { width: 1280, height: 900 } as const;

/** Persistent profile dir. Outside the repo so a consent cookie can stick. */
export function profileDir(): string {
  return path.join(os.tmpdir(), "covered-reader-profile");
}

type ReaderGlobal = typeof globalThis & {
  __coveredReaderContext?: Promise<BrowserContext> | undefined;
};

/** Survives Next dev HMR module reloads so we do not leak a Chromium per edit. */
const g = globalThis as ReaderGlobal;

async function launch(): Promise<BrowserContext> {
  // Debug only: COVERED_READER_HEADED=1 opens a visible window so a human can
  // see what Google served. Production stays headless.
  const headed = process.env.COVERED_READER_HEADED === "1";
  const context = await chromium.launchPersistentContext(profileDir(), {
    headless: !headed,
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

/** Lazily launch (or reuse) the shared persistent context. */
export function getContext(): Promise<BrowserContext> {
  if (!g.__coveredReaderContext) {
    g.__coveredReaderContext = launch().catch((err: unknown) => {
      g.__coveredReaderContext = undefined;
      throw err;
    });
  }
  return g.__coveredReaderContext;
}

/** Open a fresh page on the shared context. Caller must `page.close()`. */
export async function newPage(): Promise<Page> {
  const context = await getContext();
  return context.newPage();
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

/** Close the shared context. Used by the CLI so the process can exit. */
export async function closeBrowser(): Promise<void> {
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
