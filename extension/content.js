/**
 * Runs on google.com/search* only when the URL is a Shopping grid (`udm=28`).
 * Waits for cards or a /sorry/ challenge (max ~12s). Never bypasses a captcha.
 */
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get("udm") !== "28") return;

  const WAIT_MS = 12_000;
  const POLL_MS = 250;
  const SETTLE_MS = 400;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isChallenge() {
    const href = location.href;
    const host = location.hostname;
    if (href.includes("/sorry/") || host.startsWith("sorry.")) return true;
    if (document.querySelector("#captcha-form, form#captcha-form, #recaptcha, iframe[src*='recaptcha']")) {
      return true;
    }
    const text = (document.body?.innerText ?? "").slice(0, 20_000);
    if (/unusual traffic/i.test(text)) return true;
    if (/not a robot|verify you are human/i.test(text)) return true;
    return false;
  }

  function hasCards() {
    return Boolean(document.querySelector("product-viewer-entrypoint, div.mnr-c.pla-unit"));
  }

  function readOffers() {
    if (typeof extractGrid !== "function") return [];
    const extraction = extractGrid();
    return [...extraction.sponsored, ...extraction.browse];
  }

  async function waitAndRead() {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      if (isChallenge()) return { type: "grid", error: "challenge" };
      if (hasCards()) {
        await sleep(SETTLE_MS);
        if (isChallenge()) return { type: "grid", error: "challenge" };
        const offers = readOffers();
        if (offers.length === 0) return { type: "grid", error: "no_offers" };
        return { type: "grid", offers };
      }
      await sleep(POLL_MS);
    }
    if (isChallenge()) return { type: "grid", error: "challenge" };
    return { type: "grid", error: "timeout" };
  }

  function post(payload) {
    try {
      chrome.runtime.sendMessage(payload);
    } catch {
      // Background is gone; the page will time out.
    }
  }

  waitAndRead()
    .then(post)
    .catch((err) => post({ type: "grid", error: err instanceof Error ? err.message : String(err) }));
})();
