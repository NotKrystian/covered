/**
 * Covered reader — popup. Shows whether this browser is connected to Covered, a
 * 6-character pair code (POST /api/pair/start with this browser's covered_uid
 * cookie), the last remote job, and a "Poll now" button. Codes are cached in
 * storage until they expire so reopening the popup does not churn them.
 */
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const ORIGIN = "https://covered.kawuc.uk";
  const CODE_KEY = "covered_pair_code";

  const $ = (id) => document.getElementById(id);
  const dot = $("dot");
  const statusEl = $("status");
  const codeEl = $("code");
  const copyBtn = $("copy");
  const expiresEl = $("expires");
  const lastJobEl = $("last-job");
  const lastResultEl = $("last-result");
  const lastPollEl = $("last-poll");
  const pollBtn = $("poll");
  const newCodeBtn = $("new-code");
  $("ext-link").href = `${ORIGIN}/ext#pair`;

  let currentCode = "";

  function ago(iso) {
    if (!iso) return "—";
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return "—";
    if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
    return `${Math.round(ms / 3_600_000)} h ago`;
  }

  function setStatus(connected, text) {
    dot.classList.toggle("on", Boolean(connected));
    statusEl.textContent = text;
  }

  function showCode(code, expiresAt) {
    currentCode = code;
    codeEl.textContent = code ? `${code.slice(0, 3)} ${code.slice(3)}` : "······";
    copyBtn.disabled = !code;
    if (code && expiresAt) {
      const mins = Math.max(0, Math.round((Date.parse(expiresAt) - Date.now()) / 60_000));
      expiresEl.textContent = `Enter this on your phone, or at covered.kawuc.uk/ext in another browser. Expires in ${mins} min.`;
    }
  }

  async function cachedCode() {
    try {
      const out = await api.storage.local.get(CODE_KEY);
      const entry = out && out[CODE_KEY];
      if (entry && typeof entry.code === "string" && Date.parse(entry.expires_at) - Date.now() > 60_000) return entry;
    } catch {
      // No cache; fetch a fresh one.
    }
    return null;
  }

  async function fetchCode(force) {
    if (!force) {
      const cached = await cachedCode();
      if (cached) {
        showCode(cached.code, cached.expires_at);
        return true;
      }
    }
    try {
      const res = await fetch(`${ORIGIN}/api/pair/start`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json = await res.json();
      if (!json || !json.ok || typeof json.code !== "string") throw new Error("bad response");
      showCode(json.code, json.expires_at);
      try {
        await api.storage.local.set({ [CODE_KEY]: { code: json.code, expires_at: json.expires_at } });
      } catch {
        // Best effort.
      }
      return true;
    } catch (err) {
      showCode("", null);
      expiresEl.textContent = `Could not reach Covered (${err instanceof Error ? err.message : String(err)}).`;
      return false;
    }
  }

  async function refreshStatus() {
    let state = {};
    try {
      state = (await api.runtime.sendMessage({ type: "reader-status" })) || {};
    } catch {
      state = {};
    }
    lastJobEl.textContent = state.last_job_at ? `${ago(state.last_job_at)} · ${state.last_job_query || ""}` : "—";
    lastJobEl.title = state.last_job_query || "";
    lastResultEl.textContent = state.last_job_result || "—";
    lastPollEl.textContent = state.polling ? "polling now" : ago(state.last_poll_at);

    try {
      const res = await fetch(`${ORIGIN}/api/pair/start`, { credentials: "include", cache: "no-store" });
      const json = res.ok ? await res.json() : null;
      if (json && json.ok && json.connected) {
        const devices = json.paired_devices || 0;
        setStatus(true, `Connected · ${devices} paired device${devices === 1 ? "" : "s"}`);
      } else {
        setStatus(false, "Not connected yet — a pair code will connect this browser");
      }
    } catch {
      setStatus(false, "Covered is unreachable");
    }
  }

  copyBtn.addEventListener("click", () => {
    if (!currentCode) return;
    navigator.clipboard.writeText(currentCode).then(() => {
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    });
  });

  newCodeBtn.addEventListener("click", () => {
    newCodeBtn.disabled = true;
    fetchCode(true).finally(() => {
      newCodeBtn.disabled = false;
      void refreshStatus();
    });
  });

  pollBtn.addEventListener("click", () => {
    pollBtn.disabled = true;
    Promise.resolve(api.runtime.sendMessage({ type: "reader-poll-now" }))
      .catch(() => undefined)
      .then(() => {
        setTimeout(() => {
          pollBtn.disabled = false;
          void refreshStatus();
        }, 1200);
      });
  });

  fetchCode(false).then((ok) => {
    // Fetching the code mints the cookie if this browser had none; start polling with it.
    if (ok) Promise.resolve(api.runtime.sendMessage({ type: "reader-poll-now" })).catch(() => undefined);
    void refreshStatus();
  });
  setInterval(refreshStatus, 5000);
})();
