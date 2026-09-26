/**
 * Cap and hydrate listing photos. One data URL per offer; at most the first
 * 12 that will be shortlisted, so the decide payload stays small.
 */
import type { Offer } from "@/lib/types";
import { SHORTLIST_MAX } from "@/lib/decision";

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

function mimeToDataPrefix(contentType: string | null): string | null {
  const mime = (contentType ?? "image/jpeg").split(";")[0].trim().toLowerCase();
  switch (mime) {
    case "image/jpeg":
    case "image/jpg":
      return "data:image/jpeg;base64,";
    case "image/png":
      return "data:image/png;base64,";
    case "image/webp":
      return "data:image/webp;base64,";
    case "image/gif":
      return "data:image/gif;base64,";
    default:
      return "data:image/jpeg;base64,";
  }
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ac.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    const prefix = mimeToDataPrefix(res.headers.get("content-type"));
    if (!prefix) return null;
    return `${prefix}${buf.toString("base64")}`;
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
