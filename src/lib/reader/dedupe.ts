/**
 * Dedupe rules from the plan.
 *
 * Sponsored: the hover card is inside the same unit, so the same
 * `data-offer-id` can appear more than once. Dedupe on it.
 *
 * Browse: the same product repeats across groups. Dedupe on title+price+merchant.
 */
import type { Offer } from "@/lib/types";

function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function contentKey(offer: Offer): string {
  return `${norm(offer.title)}|${norm(offer.price)}|${norm(offer.merchant)}`;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Dedupe sponsored units by `offer_id`, falling back to content when the id is missing. */
export function dedupeSponsored(offers: Offer[]): Offer[] {
  return uniqueBy(offers, (o) => (o.offer_id ? `id:${o.offer_id}` : `c:${contentKey(o)}`));
}

/** Dedupe browse rows by title + price + merchant. */
export function dedupeBrowse(offers: Offer[]): Offer[] {
  return uniqueBy(offers, contentKey);
}
