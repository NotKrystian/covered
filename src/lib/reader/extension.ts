/**
 * Client-safe bridge to the Covered reader extension (Chrome, Brave, Firefox).
 * Do not import Playwright or other Node reader modules from here.
 */
import { OfferSchema, type Offer } from "@/lib/types";

export const EXTENSION_ID_ENV = "NEXT_PUBLIC_COVERED_EXTENSION_ID";
export const EXTENSION_ID_STORAGE_KEY = "covered_extension_id";

/** Id from the shipped `extension/manifest.json` `key` field. Env or localStorage override it. */
const MANIFEST_EXTENSION_ID = "hlllnaaelmdioofigcmnafmiimafhglf";

export type ExtensionSearchError = { error: string };
export type ExtensionSearchResult = Offer[] | ExtensionSearchError;

type ChromeRuntime = {
  sendMessage: (
    extensionId: string,
    message: unknown,
    responseCallback: (response: unknown) => void,
  ) => void;
  lastError?: { message: string };
};

function chromeRuntime(): ChromeRuntime | null {
  if (typeof window === "undefined") return null;
  const chrome = (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome;
  return chrome?.runtime ?? null;
}

export function coveredExtensionId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_COVERED_EXTENSION_ID?.trim();
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(EXTENSION_ID_STORAGE_KEY)?.trim();
      if (stored) return stored;
    } catch {
      // Private mode can throw.
    }
  }
  return MANIFEST_EXTENSION_ID;
}

export function isExtensionSearchError(value: ExtensionSearchResult): value is ExtensionSearchError {
  return !Array.isArray(value);
}

/** How long the bridge has to acknowledge before we decide it is not installed. */
const BRIDGE_ACK_MS = 500;
/** Longer than the extension's own 20 s search timeout. */
const BRIDGE_RESULT_MS = 30_000;

/**
 * Ask through the extension's page bridge (`extension/bridge.js`), which works in
 * every browser including Firefox. Resolves null when no bridge acknowledges.
 */
function searchViaBridge(query: string): Promise<unknown | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    let acked = false;
    const done = (value: unknown | null) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(ackTimer);
      clearTimeout(resultTimer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; type?: unknown; id?: unknown; payload?: unknown } | null;
      if (!data || data.source !== "covered-extension" || data.id !== id) return;
      if (data.type === "ack") acked = true;
      else if (data.type === "search-result") done(data.payload ?? { error: "unknown" });
    };
    const ackTimer = setTimeout(() => {
      if (!acked) done(null);
    }, BRIDGE_ACK_MS);
    const resultTimer = setTimeout(() => done({ error: "timeout" }), BRIDGE_RESULT_MS);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "covered-page", type: "search", id, query: query.trim() }, window.location.origin);
  });
}

/** Page bridge first (all browsers); then direct `externally_connectable` messaging (older Chrome/Brave builds). */
export async function searchViaExtension(query: string): Promise<ExtensionSearchResult> {
  const bridged = await searchViaBridge(query);
  if (bridged !== null) return normalizeExtensionResponse(bridged);
  return searchViaExternalMessage(query);
}

function searchViaExternalMessage(query: string): Promise<ExtensionSearchResult> {
  const runtime = chromeRuntime();
  const id = coveredExtensionId();
  if (!runtime || !id) return Promise.resolve({ error: "no_extension" });

  return new Promise((resolve) => {
    try {
      runtime.sendMessage(id, { type: "search", query: query.trim() }, (response) => {
        if (runtime.lastError) {
          resolve({ error: "no_extension" });
          return;
        }
        resolve(normalizeExtensionResponse(response));
      });
    } catch {
      resolve({ error: "no_extension" });
    }
  });
}

function normalizeExtensionResponse(response: unknown): ExtensionSearchResult {
  if (!response || typeof response !== "object") return { error: "unknown" };
  const rec = response as { error?: unknown; offers?: unknown };
  if (typeof rec.error === "string" && rec.error.length > 0) return { error: rec.error };
  if (!Array.isArray(rec.offers)) return { error: "unknown" };
  const offers: Offer[] = [];
  for (const item of rec.offers) {
    const parsed = OfferSchema.safeParse(item);
    if (parsed.success) offers.push(parsed.data);
  }
  if (offers.length === 0) return { error: "no_offers" };
  return offers;
}
