/**
 * The rights-premium rule and the shortlist shape — owned by the Decision+UI agent.
 *
 * The Bedrock judge decides identity, mislisting, seller and venue. This file compares
 * the discount off the full-rights listing to `protection_premium_bps`. A mislisting
 * never reaches that comparison. Do not put a pound `protection_premium_pence` rule back.
 */
import {
  DEFAULT_PROTECTION_PREMIUM_BPS,
  type Decision,
  type Listing,
  type Offer,
  type ReceiptSection,
  type UserSettings,
  type Verdict,
} from "@/lib/types";
import { formatBps, formatPence, parsePricePence } from "@/lib/money";
import type { ProductBrief } from "@/lib/judge/research";

/** One row of the shortlist the judge sees and the UI renders. Wraps an `Offer` or a `Listing`. */
export type ShortlistItem = {
  id: string;
  title: string;
  /** Integer pence, or null when the displayed price did not parse. */
  price_pence: number | null;
  /** Price as displayed. */
  price_label: string;
  merchant: string;
  delivery: string | null;
  returns: string | null;
  rating: string | null;
  rating_count: string | null;
  section: ReceiptSection;
  /** "Sale", "£50 off". Never a reason to buy. */
  badge: string | null;
  /** Fixture hints. The judge still decides. */
  venue_hint?: string;
  seller_type_hint?: string;
  /** Fixture paths and any extra remote thumbs. */
  image_urls: string[];
  /** Displayed card image src from the live/extension grid. */
  image_url?: string | null;
  /** Compressed jpeg captured in the reader, when the canvas was clean. */
  image_data_url?: string | null;
  /** Merchant product URL when the reader found one. Never a Google /aclk tracker. */
  product_url?: string | null;
  /** The original record, kept for the receipt. */
  raw: { kind: "offer"; offer: Offer } | { kind: "listing"; listing: Listing };
};

/** One line in the visible tool trace. */
export type TraceEvent = { t: string; tool: string; detail: string };

export type JudgeMode = "bedrock" | "mock";

/** Response body of `POST /api/decide`. */
export type DecideResponse = {
  verdict: Verdict;
  decisions: Record<string, Decision>;
  shortlist: ShortlistItem[];
  /** Every distinct offer from the search, each with a decision. */
  listings: ShortlistItem[];
  mode: JudgeMode;
  /** Bedrock model id when `mode === "bedrock"`, e.g. "eu.anthropic.claude-haiku-4-5-20251001-v1:0"; "mock" otherwise. */
  model: string;
  trace: TraceEvent[];
  /** Pence paid above the cheapest unprotected survivor for rights, or null when no such comparison exists. */
  premium_paid_pence: number | null;
  /** True when preference memory was injected into the judge prompt. */
  learned: boolean;
  /** Research brief brand, for client-side brand sort. Empty when unknown. */
  brief_brand: string;
};

/** Judge batches this many listings per Bedrock call so the JSON does not truncate. */
export const JUDGE_BATCH_SIZE = 6;

export function listingToItem(listing: Listing): ShortlistItem {
  return {
    id: listing.id,
    title: listing.title,
    price_pence: listing.price_pence,
    price_label: formatPence(listing.price_pence),
    merchant: listing.merchant,
    delivery: listing.delivery_text,
    returns: listing.returns_text,
    rating: listing.rating ?? null,
    rating_count: null,
    section: "fixture",
    badge: null,
    venue_hint: listing.venue,
    seller_type_hint: listing.seller_type_hint,
    image_urls: listing.image_urls,
    image_url: listing.image_urls[0] ?? null,
    image_data_url: null,
    product_url: listing.url ?? null,
    raw: { kind: "listing", listing },
  };
}

export function offerToItem(offer: Offer, index: number): ShortlistItem {
  const pence = offer.price_pence ?? parsePricePence(offer.price);
  const id =
    offer.offer_id !== undefined
      ? `sponsored-${offer.offer_id}`
      : `${offer.section}-${index + 1}`;
  return {
    id,
    title: offer.title,
    price_pence: pence,
    price_label: offer.price,
    merchant: offer.merchant,
    delivery: offer.delivery,
    returns: offer.returns ?? null,
    rating: offer.rating,
    rating_count: offer.rating_count,
    section: offer.section,
    badge: offer.badge,
    venue_hint: offer.merchant_domain,
    image_urls: offer.image_urls ?? [],
    image_url: offer.image_url ?? null,
    image_data_url: offer.image_data_url ?? null,
    product_url: offer.product_url ?? null,
    raw: { kind: "offer", offer },
  };
}

function uniqueOffers(offers: Offer[]): Offer[] {
  const seen = new Set<string>();
  const unique: Offer[] = [];
  for (const offer of offers) {
    const key =
      offer.offer_id !== undefined
        ? `id:${offer.offer_id}`
        : `tm:${offer.title.trim().toLowerCase()}|${offer.merchant.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(offer);
  }
  return unique;
}

/**
 * Every distinct offer, ad or not. The judge sees all of them (in batches).
 * `brief` is accepted for call-site compatibility; ranking no longer drops ads.
 */
export function buildShortlistFromOffers(
  offers: Offer[],
  _brief: ProductBrief | null = null,
): {
  items: ShortlistItem[];
  all: ShortlistItem[];
  deduped: number;
} {
  const unique = uniqueOffers(offers);
  const all = unique.map(offerToItem);
  return { items: all, all, deduped: offers.length - unique.length };
}

/** Listings that survived identity and the photo check — the percent rule's input. */
export function survivorsForPremium(
  items: ShortlistItem[],
  decisions: Record<string, Decision>,
): ShortlistItem[] {
  return items.filter((item) => {
    const d = decisions[item.id];
    return Boolean(d && !d.mislisting && d.same_item);
  });
}

/** A seller you can enforce against at a venue that honours it. A business badge alone is not this. */
export function isProtected(decision: Decision): boolean {
  return (
    decision.seller_type === "uk_business" &&
    (decision.venue_trust === "shop_checkout" ||
      decision.venue_trust === "marketplace_protected")
  );
}

type Priced = ShortlistItem & { price_pence: number };

function cheapest(items: Priced[]): Priced | null {
  let best: Priced | null = null;
  for (const item of items) {
    if (best === null || item.price_pence < best.price_pence) best = item;
  }
  return best;
}

/** Discount as a percent of the full-rights price, rounded for copy (800/3600 → 22). */
export function discountPercent(discountPence: number, protectedPricePence: number): number {
  if (protectedPricePence <= 0) return 0;
  return Math.round((discountPence / protectedPricePence) * 100);
}

/**
 * True when the cheaper listing's discount is past the buyer's percent.
 * Integer form of `discount / protected.price_pence * 10000 > protection_premium_bps`.
 */
export function discountBeatsPremium(
  discountPence: number,
  protectedPricePence: number,
  premiumBps: number,
): boolean {
  if (discountPence <= 0 || protectedPricePence <= 0) return false;
  return discountPence * 10_000 > premiumBps * protectedPricePence;
}

function premiumBpsOf(settings: UserSettings): number {
  return settings.protection_premium_bps ?? DEFAULT_PROTECTION_PREMIUM_BPS;
}

/**
 * Apply the protection premium to whatever survived the judge.
 *
 * Drops mislistings and anything that is not the item. Among the rest, finds the
 * cheapest protected listing (uk_business + shop_checkout or marketplace_protected)
 * and the cheapest unprotected. Discount is `protected.price − unprotected.price`,
 * as a ratio of the protected price. If there is no unprotected listing, or the
 * discount is ≤ 0, or `discount_ratio * 10000` is inside `protection_premium_bps`,
 * the shop wins. Otherwise the cheap one wins and the summary says what you give up.
 * Old `protection_premium_pence` is ignored.
 */
export function applyPremium(
  items: ShortlistItem[],
  decisions: Record<string, Decision>,
  settings: UserSettings,
): Verdict {
  const premiumBps = premiumBpsOf(settings);
  const survivors: Priced[] = [];
  let dropped = 0;
  for (const item of items) {
    const d = decisions[item.id];
    if (!d || d.mislisting || !d.same_item) {
      dropped += 1;
      continue;
    }
    if (item.price_pence === null) continue;
    survivors.push({ ...item, price_pence: item.price_pence });
  }

  const protectedBest = cheapest(
    survivors.filter((s) => isProtected(decisions[s.id])),
  );
  const unprotectedBest = cheapest(
    survivors.filter((s) => !isProtected(decisions[s.id])),
  );

  const droppedNote = dropped > 0 ? ` ${dropped} listing${dropped === 1 ? "" : "s"} dropped before price.` : "";
  const premiumLabel = formatBps(premiumBps);

  if (protectedBest) {
    const discount = unprotectedBest ? protectedBest.price_pence - unprotectedBest.price_pence : 0;
    const shopWins =
      !unprotectedBest ||
      discount <= 0 ||
      !discountBeatsPremium(discount, protectedBest.price_pence, premiumBps);
    if (shopWins) {
      let summary: string;
      if (!unprotectedBest) {
        summary = `Buying ${protectedBest.merchant} at ${formatPence(protectedBest.price_pence)}, the only listing that is the item and keeps your rights.${droppedNote}`;
      } else if (discount <= 0) {
        summary = `Buying ${protectedBest.merchant} at ${formatPence(protectedBest.price_pence)}: the cheapest listing that is the item, and it keeps your rights (14-day cancellation and a 30-day fault refund). No premium needed.${droppedNote}`;
      } else {
        const off = `${discountPercent(discount, protectedBest.price_pence)}%`;
        summary = `Buying ${protectedBest.merchant} at ${formatPence(protectedBest.price_pence)}. ${off} off the shop, inside your ${premiumLabel} (${formatPence(discount)}, ${off} of the shop): 14-day cancellation and a 30-day fault refund.${droppedNote}`;
      }
      return { chosen_id: protectedBest.id, per_offer: decisions, summary };
    }
  }

  if (unprotectedBest) {
    let summary: string;
    if (protectedBest) {
      const discount = protectedBest.price_pence - unprotectedBest.price_pence;
      const off = `${discountPercent(discount, protectedBest.price_pence)}%`;
      summary = `Buying ${unprotectedBest.merchant} at ${formatPence(unprotectedBest.price_pence)}: ${off} off, past your ${premiumLabel}, so the private listing wins and a fault is your problem (${formatPence(discount)}, ${off} of the shop). No cooling-off, no Consumer Rights Act remedy.${droppedNote}`;
    } else {
      summary = `No listing with UK rights survived. ${unprotectedBest.merchant} at ${formatPence(unprotectedBest.price_pence)} is the item, but a break is your problem.${droppedNote}`;
    }
    return { chosen_id: unprotectedBest.id, per_offer: decisions, summary };
  }

  return {
    chosen_id: null,
    per_offer: decisions,
    summary: `Nothing to buy. No listing survived the photo and identity check.${droppedNote}`,
  };
}

/** Re-run the percent rule on an existing decide response when the slider moves. */
export function reapplyPremium(result: DecideResponse, settings: UserSettings): DecideResponse {
  const verdict = applyPremium(result.listings, result.decisions, settings);
  return {
    ...result,
    verdict,
    premium_paid_pence: premiumPaid(result.listings, result.decisions, verdict),
  };
}

/** Pence paid above the cheapest unprotected survivor when a protected item was chosen. */
export function premiumPaid(
  items: ShortlistItem[],
  decisions: Record<string, Decision>,
  verdict: Verdict,
): number | null {
  if (verdict.chosen_id === null) return null;
  const chosen = items.find((i) => i.id === verdict.chosen_id);
  const chosenDecision = chosen ? decisions[chosen.id] : undefined;
  if (!chosen || !chosenDecision || chosen.price_pence === null) return null;
  if (!isProtected(chosenDecision)) return 0;
  const unprotected = cheapest(
    items
      .filter((i): i is Priced => i.price_pence !== null)
      .filter((i) => {
        const d = decisions[i.id];
        return d && !d.mislisting && d.same_item && !isProtected(d);
      }),
  );
  if (!unprotected) return 0;
  return Math.max(0, chosen.price_pence - unprotected.price_pence);
}
