/**
 * Client-safe helpers for listing photos and merchant links.
 */
import { isMonthlyOnlyItem, type ShortlistItem } from "@/lib/decision";
import { isProxyImageUrl, safeImageDataUrl, safeImageUrl } from "@/lib/photo-safety";

export function partitionCashAndMonthly(items: ShortlistItem[]): {
  cash: ShortlistItem[];
  monthly: ShortlistItem[];
} {
  const cash: ShortlistItem[] = [];
  const monthly: ShortlistItem[] = [];
  for (const item of items) {
    if (isMonthlyOnlyItem(item)) monthly.push(item);
    else cash.push(item);
  }
  return { cash, monthly };
}

/** Merchant product URL, or null when there is nothing safe to open. */
export function listingHref(item: ShortlistItem): string | null {
  const raw =
    item.product_url ??
    (item.raw.kind === "offer" ? item.raw.offer.product_url : item.raw.listing.url) ??
    null;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Prefer a captured data URL. Google thumbs that will not hotlink go through
 * `/api/image`. Local fixture paths pass through.
 */
export function listingPhotoSrc(item: ShortlistItem): string | null {
  if (item.image_data_url) {
    const data = safeImageDataUrl(item.image_data_url);
    if (data) return data;
  }
  for (const candidate of [item.image_url, item.image_urls[0]]) {
    if (!candidate) continue;
    if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
    if (isProxyImageUrl(candidate)) return `/api/image?url=${encodeURIComponent(candidate)}`;
    const safe = safeImageUrl(candidate);
    if (safe) return safe;
  }
  return null;
}
