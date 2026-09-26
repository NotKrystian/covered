/**
 * Client-safe bridge to the Covered reader extension.
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

export function searchViaExtension(query: string): Promise<ExtensionSearchResult> {
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
