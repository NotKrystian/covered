/**
 * Detect the Google JS challenge / captcha / consent interstitial.
 *
 * We classify, and at most click the consent dialog once. We never attempt to
 * bypass or solve a challenge; a challenge is a typed error and the UI falls
 * back to fixtures.
 */
import type { Page } from "playwright";
import { evaluateInPage } from "./browser";

export type PageState =
  | { kind: "cards"; sponsored: number; browse: number }
  | { kind: "consent" }
  | { kind: "challenge"; reason: string }
  | { kind: "empty" };

/** Runs inside the page. Must stay self-contained (no outer references). */
function probePage(): {
  sponsored: number;
  browse: number;
  consent: boolean;
  challenge: string | null;
} {
  const doc = document;
  const href = location.href;
  const host = location.hostname;
  const text = (doc.body?.innerText ?? "").slice(0, 20000);

  const sponsored = doc.querySelectorAll("div.mnr-c.pla-unit").length;
  const browse = doc.querySelectorAll("product-viewer-entrypoint").length;

  let challenge: string | null = null;
  if (href.includes("/sorry/") || host.startsWith("sorry.")) {
    challenge = "google /sorry/ interstitial";
  } else if (doc.querySelector("#captcha-form, form#captcha-form, #recaptcha, iframe[src*='recaptcha']")) {
    challenge = "captcha present";
  } else if (/unusual traffic/i.test(text)) {
    challenge = "unusual traffic notice";
  } else if (/not a robot|verify you are human/i.test(text)) {
    challenge = "robot check";
  } else if (/enable javascript|javascript is disabled/i.test(text) && sponsored === 0 && browse === 0) {
    challenge = "javascript challenge";
  }

  const consent =
    host.startsWith("consent.") ||
    Boolean(doc.querySelector("#L2AGLb, #W0wltc, form[action*='consent.google']")) ||
    (/before you continue/i.test(text) && sponsored === 0 && browse === 0);

  return { sponsored, browse, consent, challenge };
}

/** Classify the current document. Cheap; safe to poll. */
export async function classifyPage(page: Page): Promise<PageState> {
  const probe = await evaluateInPage(page, probePage);
  if (probe.challenge) return { kind: "challenge", reason: probe.challenge };
  if (probe.sponsored > 0 || probe.browse > 0) {
    return { kind: "cards", sponsored: probe.sponsored, browse: probe.browse };
  }
  if (probe.consent) return { kind: "consent" };
  return { kind: "empty" };
}

/**
 * Click "Accept all" (or "Reject all") on the consent dialog once.
 * Returns true when a button was clicked.
 */
export async function acceptConsentOnce(page: Page): Promise<boolean> {
  const candidates = [
    "#L2AGLb",
    "button:has-text('Accept all')",
    "#W0wltc",
    "button:has-text('Reject all')",
    "button:has-text('I agree')",
  ];
  for (const selector of candidates) {
    const button = page.locator(selector).first();
    try {
      if ((await button.count()) === 0) continue;
      await button.click({ timeout: 3000 });
      return true;
    } catch {
      // Try the next candidate.
    }
  }
  return false;
}
