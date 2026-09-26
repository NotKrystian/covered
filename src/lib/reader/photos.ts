/**
 * Cap and hydrate listing photos. One data URL per offer; at most the first
 * 12 that will be shortlisted, so the decide payload stays small.
 */
import type { Offer } from "@/lib/types";
import { SHORTLIST_MAX } from "@/lib/decision";
import { isGoogleImageUrl, sniffImageFormat } from "@/lib/photo-safety";

export const OFFER_PHOTO_CAP = SHORTLIST_MAX;

const FETCH_TIMEOUT_MS = 4_000;
const MAX_BYTES = 180_000;

/** Keep `image_data_url` on at most `cap` offers; later ones keep `image_url` only. */
export function capOfferPhotos(offers: Offer[], cap = OFFER_PHOTO_CAP): Offer[] {
  let kept = 0;
  return offers.map((offer) => {
    if (!offer.image_data_url) return offer;
    if (kept >= cap) {
      return { ...offer, image_data_url: null };
    }
    kept += 1;
    return offer;
  });
}

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

/**
 * For offers that have an `image_url` but no data URL, fetch the first `cap`
 * thumbnails (encrypted-tbn is public) so the judge can receive image bytes.
 */
export async function hydrateOfferPhotos(offers: Offer[], cap = OFFER_PHOTO_CAP): Promise<Offer[]> {
  let attached = offers.filter((o) => Boolean(o.image_data_url)).length;
  const out: Offer[] = [];
  for (const offer of offers) {
    if (offer.image_data_url || !offer.image_url || attached >= cap) {
      out.push(offer);
      continue;
    }
    const dataUrl = await fetchAsDataUrl(offer.image_url);
    if (dataUrl) {
      attached += 1;
      out.push({ ...offer, image_data_url: dataUrl });
    } else {
      out.push(offer);
    }
  }
  return capOfferPhotos(out, cap);
}
