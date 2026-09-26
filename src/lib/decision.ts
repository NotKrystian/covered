/**
 * The pound rule and the shortlist shape — owned by the Decision+UI agent.
 *
 * Grok judges identity, mislisting, seller and venue. This file only compares
 * integer pence to the numbers the user set. A mislisting never reaches the sum.
 */
import type {
  Decision,
  Listing,
  Offer,
  ReceiptSection,
  UserSettings,
  Verdict,
} from "@/lib/types";
import { formatPence, parsePricePence } from "@/lib/money";

/** One row of the shortlist Grok sees and the UI renders. Wraps an `Offer` or a `Listing`. */
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
  /** Fixture hints. Grok still decides. */
  venue_hint?: string;
  seller_type_hint?: string;
  /** Only fixtures carry photos Grok can trust. */
  image_urls: string[];
  /** The original record, kept for the receipt. */
  raw: { kind: "offer"; offer: Offer } | { kind: "listing"; listing: Listing };
};

/** One line in the visible tool trace. */
export type TraceEvent = { t: string; tool: string; detail: string };

export type JudgeMode = "grok" | "mock";

/** Response body of `POST /api/decide`. */
export type DecideResponse = {
  verdict: Verdict;
  decisions: Record<string, Decision>;
  shortlist: ShortlistItem[];
  mode: JudgeMode;
  trace: TraceEvent[];
  /** Pence paid above the cheapest unprotected survivor for rights, or null when no such comparison exists. */
  premium_paid_pence: number | null;
};

export const SHORTLIST_MAX = 12;

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
    raw: { kind: "offer", offer },
  };
}

/** Dedupe, sort by price ascending (unparsed prices last), cap at `SHORTLIST_MAX`. */
export function buildShortlistFromOffers(offers: Offer[]): {
  items: ShortlistItem[];
  deduped: number;
} {
  const seen = new Set<string>();
  const unique: Offer[] = [];
  for (const offer of offers) {
    const key =
      offer.offer_id !== undefined
        ? `id:${offer.offer_id}`
        : `tpm:${offer.title}|${offer.price}|${offer.merchant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(offer);
  }
  const items = unique.map(offerToItem);
  items.sort((a, b) => {
    if (a.price_pence === null && b.price_pence === null) return 0;
    if (a.price_pence === null) return 1;
    if (b.price_pence === null) return -1;
    return a.price_pence - b.price_pence;
  });
  return { items: items.slice(0, SHORTLIST_MAX), deduped: offers.length - unique.length };
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

/**
 * Apply the protection premium to whatever survived Grok.
 *
 * Drops mislistings and anything that is not the item. Among the rest, finds the
 * cheapest protected and the cheapest unprotected. If the protected one is within
 * `protection_premium_pence` of the unprotected one (or nothing unprotected exists),
 * it is chosen. Otherwise the cheap one wins and the summary says what you give up.
 */
export function applyPremium(
  items: ShortlistItem[],
  decisions: Record<string, Decision>,
  settings: UserSettings,
): Verdict {
  const premium = settings.protection_premium_pence;
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

  if (protectedBest && (!unprotectedBest || protectedBest.price_pence - unprotectedBest.price_pence <= premium)) {
    const summary = unprotectedBest
      ? `Buying ${protectedBest.merchant} at ${formatPence(protectedBest.price_pence)}. That is ${formatPence(protectedBest.price_pence - unprotectedBest.price_pence)} more than ${unprotectedBest.merchant}, inside your ${formatPence(premium)} for rights: 14-day cancellation and a 30-day fault refund.${droppedNote}`
      : `Buying ${protectedBest.merchant} at ${formatPence(protectedBest.price_pence)}, the only listing that is the item and keeps your rights.${droppedNote}`;
    return { chosen_id: protectedBest.id, per_offer: decisions, summary };
  }

  if (unprotectedBest) {
    const summary = protectedBest
      ? `Buying ${unprotectedBest.merchant} at ${formatPence(unprotectedBest.price_pence)}: cheaper by ${formatPence(protectedBest.price_pence - unprotectedBest.price_pence)} than ${protectedBest.merchant}, which beats your ${formatPence(premium)}, but a break is your problem. No cooling-off, no Consumer Rights Act remedy.${droppedNote}`
      : `No listing with UK rights survived. ${unprotectedBest.merchant} at ${formatPence(unprotectedBest.price_pence)} is the item, but a break is your problem.${droppedNote}`;
    return { chosen_id: unprotectedBest.id, per_offer: decisions, summary };
  }

  return {
    chosen_id: null,
    per_offer: decisions,
    summary: `Nothing to buy. No listing survived the photo and identity check.${droppedNote}`,
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
