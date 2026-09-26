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
      const raw = Array.isArray(message.offers) ? message.offers : [];
      attachMissingPhotos(raw)
        .then((offers) => finish({ offers }))
        .catch(() => finish({ offers: raw }));
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

const PHOTO_CAP = 12;
const PHOTO_MAX_W = 360;
const PHOTO_QUALITY = 0.6;

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

async function blobToJpegDataUrl(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, PHOTO_MAX_W / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_QUALITY });
  const buf = await out.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

async function fetchAsJpegDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob || blob.size === 0) return null;
  return blobToJpegDataUrl(blob);
}

/** Fill image_data_url for the first 12 offers when the content-script canvas was tainted. */
async function attachMissingPhotos(offers) {
  let kept = 0;
  const out = [];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") {
      out.push(offer);
      continue;
    }
    if (typeof offer.image_data_url === "string" && offer.image_data_url.length > 0) {
      if (kept >= PHOTO_CAP) {
        const copy = { ...offer };
        delete copy.image_data_url;
        out.push(copy);
      } else {
        kept += 1;
        out.push(offer);
      }
      continue;
    }
    if (kept >= PHOTO_CAP || !isHttpUrl(offer.image_url)) {
      out.push(offer);
      continue;
    }
    try {
      const dataUrl = await fetchAsJpegDataUrl(offer.image_url);
      if (dataUrl) {
        kept += 1;
        out.push({ ...offer, image_data_url: dataUrl });
        continue;
      }
    } catch {
      // Tainted or blocked; keep image_url for the UI.
    }
    out.push(offer);
  }
  return out;
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
