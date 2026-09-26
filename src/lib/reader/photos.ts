/**
 * Hydrate listing photos. Every offer keeps its data URL; missing Google thumbs
 * are fetched so the judge can receive image bytes.
 */
import type { Offer } from "@/lib/types";
import { isGoogleImageUrl, sniffImageFormat } from "@/lib/photo-safety";

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 180_000;
const HYDRATE_CONCURRENCY = 8;

/**
 * Server-side fetch, so it only ever touches Google's image CDNs over https, refuses
 * redirects (no bouncing to an internal address), and labels the result by its magic
 * bytes rather than the Content-Type, so a non-image never becomes a "jpeg".
 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (!isGoogleImageUrl(url)) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "error", cache: "no-store", signal: ac.signal });
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    const format = sniffImageFormat(buf);
    if (!format) return null;
    return `data:image/${format};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Keep every captured data URL. The reader already squeezed each to ~40 KB. */
export function capOfferPhotos(offers: Offer[]): Offer[] {
  return offers;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/**
 * For offers that have an `image_url` but no data URL, fetch the thumbnail
 * (encrypted-tbn is public) so the judge can receive image bytes.
 */
export async function hydrateOfferPhotos(offers: Offer[]): Promise<Offer[]> {
  return mapPool(offers, HYDRATE_CONCURRENCY, async (offer) => {
    if (offer.image_data_url || !offer.image_url) return offer;
    const dataUrl = await fetchAsDataUrl(offer.image_url);
    return dataUrl ? { ...offer, image_data_url: dataUrl } : offer;
  });
}
