/**
 * Covered reader — background service worker.
 *
 * The Covered page sends `{ type: "search", query }`. We open an inactive
 * Shopping tab in this browser session, wait for the content script, close
 * the tab, and reply with offers or `{ error }`. We do not focus the tab,
 * solve captchas, or attach a debugger.
 */

const SEARCH_TIMEOUT_MS = 20_000;

function gridUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=28&hl=en&gl=uk`;
}

function isSorryUrl(url) {
  return typeof url === "string" && (/\/sorry\//.test(url) || /sorry\./i.test(url));
}

function runSearch(query) {
  return new Promise((resolve) => {
    let tabId;
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (tabId !== undefined) {
        chrome.tabs.remove(tabId).catch(() => undefined);
      }
      resolve(payload);
    };

    const timer = setTimeout(() => finish({ error: "timeout" }), SEARCH_TIMEOUT_MS);

    const onMessage = (message, sender) => {
      if (sender.tab?.id !== tabId) return;
      if (!message || message.type !== "grid") return;
      if (typeof message.error === "string" && message.error.length > 0) {
        finish({ error: message.error });
        return;
      }
      finish({ offers: Array.isArray(message.offers) ? message.offers : [] });
    };

    const onUpdated = (id, info, tab) => {
      if (id !== tabId) return;
      if (isSorryUrl(info.url) || isSorryUrl(tab.url)) finish({ error: "challenge" });
    };

    const onRemoved = (id) => {
      if (id === tabId) finish({ error: "tab_closed" });
    };

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);

    chrome.tabs.create({ url: gridUrl(query), active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        finish({ error: chrome.runtime.lastError?.message || "tab_create_failed" });
        return;
      }
      tabId = tab.id;
    });
  });
}

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "search") {
    sendResponse({ error: "unknown_message" });
    return;
  }
  const query = typeof message.query === "string" ? message.query.trim() : "";
  if (!query) {
    sendResponse({ error: "empty_query" });
    return;
  }
  runSearch(query)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
});
