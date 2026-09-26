/**
 * Covered reader — background script (Chrome/Brave service worker, Firefox event page).
 *
 * The Covered page asks for `{ type: "search", query }`, either through the page
 * bridge content script (every browser) or `externally_connectable` (Chrome/Brave
 * only; Firefox has no such thing). We open an inactive Shopping tab in this
 * browser session, wait for the content script, close the tab, and reply with
 * offers or `{ error }`. We do not focus the tab, solve captchas, or attach a debugger.
 *
 * Limit buys: alarm "covered-limits" re-reads each watching query and POSTs
 * offers to /api/limits/run. Demo cadence is DEMO_CHECKS_PER_DAY (24 → every
 * 60 minutes). Production would be once a day: periodInMinutes: 1440.
 *
 * 14-day price-drop switch: the same alarm re-reads the query of each order still
 * inside its window (GET /api/switch) and POSTs offers to /api/switch/run. The
 * server judges them and only stores a switch offer; buying still needs the user.
 */

// Firefox exposes promise-based `browser`; Chrome MV3's `chrome` also returns promises.
const api = globalThis.browser ?? globalThis.chrome;

const SEARCH_TIMEOUT_MS = 20_000;
const QUERY_MAX = 200;
/** Pages allowed to ask for a search. Mirrors the bridge content script's matches. */
const COVERED_ORIGINS = ["https://covered.kawuc.uk", "http://localhost:3000", "http://127.0.0.1:3000"];
const PRODUCTION_ORIGIN = "https://covered.kawuc.uk";
/** Dev host — same cookie jar as `pnpm dev`. */
const DEV_ORIGIN = "http://localhost:3000";
/**
 * Demo: 24 checks a day. Production would be 1 (periodInMinutes: 1440).
 * DEMO_CHECKS_PER_DAY is what ships.
 */
const DEMO_CHECKS_PER_DAY = 24;
const ALARM_PERIOD_MINUTES = 1440 / DEMO_CHECKS_PER_DAY;
const LIMITS_ALARM = "covered-limits";

function gridUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&udm=28&hl=en&gl=uk`;
}

function isSorryUrl(url) {
  return typeof url === "string" && (/\/sorry\//.test(url) || /sorry\./i.test(url));
}

function isCoveredSender(sender) {
  try {
    return COVERED_ORIGINS.includes(new URL(sender.url ?? sender.tab?.url ?? "").origin);
  } catch {
    return false;
  }
}

function runSearch(query) {
  return new Promise((resolve) => {
    let tabId;
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      api.runtime.onMessage.removeListener(onMessage);
      api.tabs.onUpdated.removeListener(onUpdated);
      api.tabs.onRemoved.removeListener(onRemoved);
      if (tabId !== undefined) {
        Promise.resolve(api.tabs.remove(tabId)).catch(() => undefined);
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

    api.runtime.onMessage.addListener(onMessage);
    api.tabs.onUpdated.addListener(onUpdated);
    api.tabs.onRemoved.addListener(onRemoved);

    Promise.resolve(api.tabs.create({ url: gridUrl(query), active: false })).then(
      (tab) => {
        if (!tab?.id) finish({ error: "tab_create_failed" });
        else tabId = tab.id;
      },
      (err) => finish({ error: err?.message || "tab_create_failed" }),
    );
  });
}

const PHOTO_MAX_W = 480;
const PHOTO_MAX_BYTES = 40 * 1024;
const PHOTO_QUALITIES = [0.7, 0.55, 0.4, 0.28, 0.18];

/** Only Google's image CDNs (what the grid draws from, and what host_permissions allow), https only. */
function isGoogleImageUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /^[a-z0-9-]+\.(?:gstatic\.com|googleusercontent\.com|ggpht\.com)$/.test(url.hostname);
  } catch {
    return false;
  }
}

function bytesToDataUrl(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(binary)}`;
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
  let last = null;
  for (const quality of PHOTO_QUALITIES) {
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
    const buf = await out.arrayBuffer();
    if (buf.byteLength <= PHOTO_MAX_BYTES || quality === PHOTO_QUALITIES[PHOTO_QUALITIES.length - 1]) {
      return bytesToDataUrl(new Uint8Array(buf));
    }
    last = buf;
  }
  return last ? bytesToDataUrl(new Uint8Array(last)) : null;
}

async function fetchAsJpegDataUrl(url) {
  const res = await fetch(url, { redirect: "error", credentials: "omit" });
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob || blob.size === 0) return null;
  return blobToJpegDataUrl(blob);
}

/** Fill image_data_url for every offer when the content-script canvas was tainted. Never drop a captured photo. */
async function attachMissingPhotos(offers) {
  const out = [];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") {
      out.push(offer);
      continue;
    }
    if (typeof offer.image_data_url === "string" && offer.image_data_url.length > 0) {
      out.push(offer);
      continue;
    }
    if (!isGoogleImageUrl(offer.image_url)) {
      out.push(offer);
      continue;
    }
    try {
      const dataUrl = await fetchAsJpegDataUrl(offer.image_url);
      if (dataUrl) {
        out.push({ ...offer, image_data_url: dataUrl });
        continue;
      }
    } catch {
      // Tainted or blocked; keep image_url for the UI proxy.
    }
    out.push(offer);
  }
  return out;
}

/** Validate the request, run it, and answer through `sendResponse`. Returns true (async reply). */
function handleSearch(message, sendResponse) {
  const query = typeof message.query === "string" ? message.query.trim().slice(0, QUERY_MAX) : "";
  if (!query) {
    sendResponse({ error: "empty_query" });
    return true;
  }
  runSearch(query)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err instanceof Error ? err.message : String(err) }));
  return true;
}

// Page bridge (bridge.js on the Covered app): Chrome, Brave and Firefox.
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "search" || !isCoveredSender(sender)) return undefined;
  return handleSearch(message, sendResponse);
});

// Direct page messaging via externally_connectable: Chrome and Brave only.
api.runtime.onMessageExternal?.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "search") {
    sendResponse({ error: "unknown_message" });
    return undefined;
  }
  return handleSearch(message, sendResponse);
});

function ensureLimitsAlarm() {
  if (!api.alarms) return;
  Promise.resolve(api.alarms.get(LIMITS_ALARM)).then((existing) => {
    if (!existing) {
      api.alarms.create(LIMITS_ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });
    }
  }).catch(() => {
    api.alarms.create(LIMITS_ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });
  });
}

async function limitsFrom(origin) {
  const res = await fetch(`${origin}/api/limits`, { credentials: "include" });
  if (!res.ok) return [];
  const json = await res.json();
  return json && json.ok && Array.isArray(json.limits) ? json.limits : [];
}

async function checkOneLimit(origin, limit) {
  const result = await runSearch(limit.query);
  if (result && result.error === "challenge") return;
  if (!result || result.error || !Array.isArray(result.offers)) return;
  await fetch(`${origin}/api/limits/run`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: limit.id, offers: result.offers }),
  });
}

async function switchWatchesFrom(origin) {
  const res = await fetch(`${origin}/api/switch`, { credentials: "include" });
  if (!res.ok) return [];
  const json = await res.json();
  return json && json.ok && Array.isArray(json.watches) ? json.watches : [];
}

async function checkOneSwitch(origin, watch) {
  const result = await runSearch(watch.order.query);
  if (!result || result.error || !Array.isArray(result.offers)) return;
  await fetch(`${origin}/api/switch/run`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: watch.order.id, offers: result.offers }),
  });
}

async function runSwitchChecks(origin) {
  let watching = [];
  try {
    watching = (await switchWatchesFrom(origin)).filter((watch) => watch && watch.watching && watch.order);
  } catch {
    return;
  }
  for (const watch of watching) {
    try {
      await checkOneSwitch(origin, watch);
    } catch {
      // One order failed; keep going so the rest still get a chance.
    }
  }
}

let limitsBusy = false;

async function runLimitChecks() {
  if (limitsBusy) return;
  limitsBusy = true;
  try {
    for (const origin of [PRODUCTION_ORIGIN, DEV_ORIGIN]) {
      let watching = [];
      try {
        watching = (await limitsFrom(origin)).filter((limit) => limit && limit.status === "watching");
      } catch {
        continue;
      }
      for (const limit of watching) {
        try {
          await checkOneLimit(origin, limit);
        } catch {
          // One query failed; keep going so the rest still get a chance.
        }
      }
      await runSwitchChecks(origin);
    }
  } finally {
    limitsBusy = false;
  }
}

ensureLimitsAlarm();
api.runtime.onInstalled?.addListener(ensureLimitsAlarm);
api.runtime.onStartup?.addListener(ensureLimitsAlarm);
api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === LIMITS_ALARM) void runLimitChecks();
});
