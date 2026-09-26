/**
 * Client-side listing sort. Operates on offers already loaded; never re-fetches.
 * Brand is derived (no structured field). Shipping is parsed from delivery text.
 * Buyer-protection rank uses the decision when present, else the listing text.
 */
import type { Decision } from "@/lib/types";
import type { ShortlistItem } from "@/lib/decision";

export const SORT_KEYS = ["price_asc", "price_desc", "brand", "shipping", "protections"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const DEFAULT_SORT: SortKey = "price_asc";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "price_asc", label: "Price · low to high" },
  { key: "price_desc", label: "Price · high to low" },
  { key: "brand", label: "Brand" },
  { key: "shipping", label: "Shipping cost" },
  { key: "protections", label: "Buyer protections" },
];

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

/** First meaningful token of the title, skipping a leading "The". */
function firstTitleToken(title: string): string {
  const tokens = title.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const cleaned = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!cleaned) continue;
    if (cleaned.toLowerCase() === "the") continue;
    return cleaned;
  }
  return "";
}

/**
 * Brand is not a structured field. Prefer the research brief brand when the
 * title starts with it (case-insensitive); otherwise the first meaningful
 * title token (skip "The"); otherwise the merchant.
 */
export function listingBrand(item: ShortlistItem, briefBrand: string): string {
  const brand = briefBrand.trim();
  if (brand && item.title.toLowerCase().startsWith(brand.toLowerCase())) {
    return brand;
  }
  return firstTitleToken(item.title) || item.merchant;
}

/** A £ amount anywhere in the string, in pence. */
function poundAmountIn(text: string): number | null {
  const match = text.match(/£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/);
  if (!match) return null;
  const pounds = Number(match[1].replace(/,/g, ""));
  const pence = Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isFinite(pounds) || !Number.isFinite(pence)) return null;
  return pounds * 100 + pence;
}

/**
 * Shipping cost in pence, or null when unknown (sorts last).
 * "free" → 0; a £ amount → that many pence; collection / click-and-collect
 * with no price → 0.
 */
export function shippingPence(delivery: string | null | undefined): number | null {
  if (!delivery || !delivery.trim()) return null;
  const text = delivery.toLowerCase();
  if (/\bfree\b/.test(text)) return 0;
  const amount = poundAmountIn(delivery);
  if (amount !== null) return amount;
  if (/\bcollection only\b/.test(text) || /\bclick\s*(?:and|&)\s*collect\b/.test(text)) {
    return 0;
  }
  return null;
}

function mentionsFourteenOrFreeReturns(returns: string | null | undefined): boolean {
  if (!returns) return false;
  const text = returns.toLowerCase();
  return /\b14[-\s]?day/.test(text) || /\bfree returns\b/.test(text);
}

/**
 * Strongest first: 0 = uk shop / 14-day or free returns, 1 = uk business or
 * marketplace protection, 2 = overseas, 3 = private / stranger, 4 = unclear.
 * Sponsored is ignored.
 */
export function protectionRank(item: ShortlistItem, decision: Decision | undefined): number {
  if (decision) {
    const returnsBoost = mentionsFourteenOrFreeReturns(item.returns);
    if (decision.seller_type === "uk_business" && (decision.venue_trust === "shop_checkout" || returnsBoost)) {
      return 0;
    }
    if (decision.seller_type === "uk_business" || decision.venue_trust === "marketplace_protected") {
      return 1;
    }
    if (decision.seller_type === "overseas_business") {
      return 2;
    }
    if (decision.seller_type === "private" || decision.venue_trust === "stranger") {
      return 3;
    }
    return 4;
  }

  const hay = `${item.returns ?? ""} ${item.delivery ?? ""} ${item.venue_hint ?? ""} ${item.merchant}`.toLowerCase();
  if (mentionsFourteenOrFreeReturns(item.returns)) return 0;
  if (/\bmarketplace[, ]*protected\b/.test(hay) || /\bbuyer protection\b/.test(hay)) return 1;
  if (/\boverseas\b/.test(hay) || /\bships from\b/.test(hay) || /\binternational\b/.test(hay)) return 2;
  if (/\bprivate\b/.test(hay) || /\bstranger\b/.test(hay) || /\bfacebook\b/.test(hay)) return 3;
  return 4;
}

function comparePriceAsc(a: ShortlistItem, b: ShortlistItem): number {
  const aMissing = a.price_pence === null;
  const bMissing = b.price_pence === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return (a.price_pence as number) - (b.price_pence as number);
}

function comparePriceDesc(a: ShortlistItem, b: ShortlistItem): number {
  const aMissing = a.price_pence === null;
  const bMissing = b.price_pence === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return (b.price_pence as number) - (a.price_pence as number);
}

/**
 * After any sort, the verdict's chosen row sits first. The rest keep the
 * selected order. No chosen id → no pin. Same row, not a duplicate banner.
 */
export function pinChosen(items: ShortlistItem[], chosenId: string | null | undefined): ShortlistItem[] {
  if (!chosenId) return items;
  const idx = items.findIndex((item) => item.id === chosenId);
  if (idx <= 0) return items;
  const next = items.slice();
  const [chosen] = next.splice(idx, 1);
  return [chosen, ...next];
}

export function sortListings(
  items: ShortlistItem[],
  key: SortKey,
  decisions: Record<string, Decision> = {},
  briefBrand = "",
  chosenId: string | null = null,
): ShortlistItem[] {
  const copy = items.slice();
  copy.sort((a, b) => {
    switch (key) {
      case "price_asc":
        return comparePriceAsc(a, b);
      case "price_desc":
        return comparePriceDesc(a, b);
      case "brand": {
        const brandCmp = listingBrand(a, briefBrand).localeCompare(listingBrand(b, briefBrand), "en", {
          sensitivity: "base",
        });
        return brandCmp !== 0 ? brandCmp : comparePriceAsc(a, b);
      }
      case "shipping": {
        const aShip = shippingPence(a.delivery);
        const bShip = shippingPence(b.delivery);
        const aMissing = aShip === null;
        const bMissing = bShip === null;
        if (aMissing && bMissing) return comparePriceAsc(a, b);
        if (aMissing) return 1;
        if (bMissing) return -1;
        if (aShip !== bShip) return (aShip as number) - (bShip as number);
        return comparePriceAsc(a, b);
      }
      case "protections": {
        const rankCmp = protectionRank(a, decisions[a.id]) - protectionRank(b, decisions[b.id]);
        return rankCmp !== 0 ? rankCmp : comparePriceAsc(a, b);
      }
      default: {
        const never: never = key;
        return never;
      }
    }
  });
  return pinChosen(copy, chosenId);
}
