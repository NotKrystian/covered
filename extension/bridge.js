/**
 * Covered reader — page bridge. Runs only on the Covered app (see manifest matches).
 *
 * Firefox does not let a web page message an extension directly (no
 * `externally_connectable`), so the page posts a window message and this script
 * relays it to the background. Chrome and Brave use the same path.
 *
 * Page → bridge: { source: "covered-page", type: "search", id, query }
 * Bridge → page: { source: "covered-extension", type: "ack", id } at once, then
 *                { source: "covered-extension", type: "search-result", id, payload }
 */
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const QUERY_MAX = 200;

  function reply(message) {
    window.postMessage({ source: "covered-extension", ...message }, location.origin);
  }

  window.addEventListener("message", (event) => {
    // Only this page's own window, never another frame or origin.
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "covered-page" || data.type !== "search") return;
    const id = typeof data.id === "string" ? data.id.slice(0, 64) : "";
    const query = typeof data.query === "string" ? data.query.trim().slice(0, QUERY_MAX) : "";
    if (!id) return;
    reply({ type: "ack", id });
    if (!query) {
      reply({ type: "search-result", id, payload: { error: "empty_query" } });
      return;
    }
    Promise.resolve(api.runtime.sendMessage({ type: "search", query }))
      .then((payload) => reply({ type: "search-result", id, payload: payload ?? { error: "unknown" } }))
      .catch((err) =>
        reply({ type: "search-result", id, payload: { error: err instanceof Error ? err.message : String(err) } }),
      );
  });
})();
