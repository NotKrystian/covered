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
 *
 * Remote reader: any client (the iPhone app, Safari, a laptop without this
 * extension) queues `{ query }` at POST /api/reader/jobs. Alarm
 * "covered-reader-poll" (every minute) wakes this worker; while awake it holds a
 * 20 s long-poll on GET /api/reader/jobs/next, runs the same inactive-tab read,
 * POSTs offers (or `{ error: "challenge" }`) to /api/reader/jobs/:id/result and
 * closes the tab. One job at a time. No Covered page needs to be open.
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
/** Remote reader: the alarm that wakes the worker; the long-poll keeps it busy while awake. */
const READER_ALARM = "covered-reader-poll";
const READER_ALARM_MINUTES = 1;
/** Server caps the long-poll at 20 s; ask for exactly that. */
const READER_LONG_POLL_SECONDS = 20;
/** Stop the in-worker loop after this many consecutive empty polls per origin; the alarm restarts it. */
const READER_MAX_IDLE_POLLS = 90;
/** After a network error on an origin, leave it alone for this long. */
const READER_BACKOFF_MS = 5 * 60 * 1000;
/** Where the popup reads status from (survives worker sleep). */
const READER_STATE_KEY = "covered_reader_state";

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

// ---- remote reader ---------------------------------------------------------

function ensureReaderAlarm() {
  if (!api.alarms) return;
  Promise.resolve(api.alarms.get(READER_ALARM)).then((existing) => {
    if (!existing) {
      api.alarms.create(READER_ALARM, { periodInMinutes: READER_ALARM_MINUTES });
    }
  }).catch(() => {
    api.alarms.create(READER_ALARM, { periodInMinutes: READER_ALARM_MINUTES });
  });
}

async function readState() {
  if (!api.storage?.local) return {};
  try {
    const out = await api.storage.local.get(READER_STATE_KEY);
    return (out && out[READER_STATE_KEY]) || {};
  } catch {
    return {};
  }
}

async function patchState(patch) {
  if (!api.storage?.local) return;
  try {
    const current = await readState();
    await api.storage.local.set({ [READER_STATE_KEY]: { ...current, ...patch } });
  } catch {
    // Storage is best-effort; the popup just shows less.
  }
}

/** GET /next with the browser's own cookie. Returns { job } | { empty: true } | { error }. */
async function fetchNextJob(origin) {
  const res = await fetch(`${origin}/api/reader/jobs/next?wait=${READER_LONG_POLL_SECONDS}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (res.status === 204) return { empty: true };
  if (res.status === 401) return { error: "not_connected" };
  if (!res.ok) return { error: `http_${res.status}` };
  const json = await res.json();
  if (!json || !json.ok || !json.job || typeof json.job.job_id !== "string") return { error: "bad_response" };
  return { job: json.job };
}

async function postJobResult(origin, jobId, payload) {
  const res = await fetch(`${origin}/api/reader/jobs/${encodeURIComponent(jobId)}/result`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

/** Run one queued job: same inactive-tab read as the page path, then report back. */
async function runReaderJob(origin, job) {
  const query = typeof job.query === "string" ? job.query.trim().slice(0, QUERY_MAX) : "";
  await patchState({ last_job_at: new Date().toISOString(), last_job_query: query, last_job_result: "running", last_origin: origin });
  let payload;
  if (!query) {
    payload = { error: "empty_query" };
  } else {
    const result = await runSearch(query);
    if (result && Array.isArray(result.offers) && !result.error) payload = { offers: result.offers };
    else payload = { error: (result && result.error) || "unknown" };
  }
  let posted = false;
  try {
    posted = await postJobResult(origin, job.job_id, payload);
  } catch {
    posted = false;
  }
  const summary = payload.offers ? `${payload.offers.length} offers` : payload.error;
  await patchState({ last_job_result: posted ? summary : `${summary} (post failed)` });
}

let readerBusy = false;
const readerBackoffUntil = { [PRODUCTION_ORIGIN]: 0, [DEV_ORIGIN]: 0 };

/** Any extension API call resets Chrome's 30 s idle timer, so a 20 s long-poll never strands the worker. */
function keepAlive() {
  try {
    return Promise.resolve(api.runtime.getPlatformInfo()).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

/**
 * Long-poll loop. Alternates between the production host and the dev host; an
 * origin that errors is skipped for READER_BACKOFF_MS. Exits after a run of empty
 * polls (or when both origins are backing off) and waits for the next alarm.
 */
async function pollReaderJobs(reason) {
  if (readerBusy) return;
  readerBusy = true;
  await patchState({ polling: true, last_poll_at: new Date().toISOString(), last_poll_reason: reason || "alarm" });
  let idle = 0;
  try {
    while (idle < READER_MAX_IDLE_POLLS) {
      await keepAlive();
      const now = Date.now();
      const origins = [PRODUCTION_ORIGIN, DEV_ORIGIN].filter((origin) => readerBackoffUntil[origin] <= now);
      if (origins.length === 0) break;
      let sawJob = false;
      for (const origin of origins) {
        let next;
        try {
          next = await fetchNextJob(origin);
        } catch {
          readerBackoffUntil[origin] = Date.now() + READER_BACKOFF_MS;
          continue;
        }
        if (next.job) {
          sawJob = true;
          try {
            await runReaderJob(origin, next.job);
          } catch (err) {
            await patchState({ last_job_result: err instanceof Error ? err.message : String(err) });
          }
        } else if (next.error) {
          if (next.error === "not_connected" && origin === PRODUCTION_ORIGIN) {
            await patchState({ connected: false });
          }
          readerBackoffUntil[origin] = Date.now() + READER_BACKOFF_MS;
        } else if (origin === PRODUCTION_ORIGIN) {
          await patchState({ connected: true, last_poll_at: new Date().toISOString() });
        }
      }
      idle = sawJob ? 0 : idle + 1;
    }
  } finally {
    readerBusy = false;
    await patchState({ polling: false });
  }
}

/** Popup asks for status / a manual poll. */
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || sender.id !== api.runtime.id) return undefined;
  if (message.type === "reader-status") {
    readState().then((state) => sendResponse({ ...state, polling: readerBusy })).catch(() => sendResponse({}));
    return true;
  }
  if (message.type === "reader-poll-now") {
    for (const origin of Object.keys(readerBackoffUntil)) readerBackoffUntil[origin] = 0;
    void pollReaderJobs("popup");
    sendResponse({ ok: true, started: !readerBusy });
    return undefined;
  }
  return undefined;
});

function onWake() {
  ensureLimitsAlarm();
  ensureReaderAlarm();
  void pollReaderJobs("startup");
}

onWake();
api.runtime.onInstalled?.addListener(onWake);
api.runtime.onStartup?.addListener(onWake);
api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === LIMITS_ALARM) void runLimitChecks();
  if (alarm.name === READER_ALARM) void pollReaderJobs("alarm");
});
