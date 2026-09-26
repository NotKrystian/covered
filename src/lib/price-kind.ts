/**
 * Classify a shopping-grid price as cash (one-off / handset) or a pay-monthly
 * tariff. A £30/month contract must never be treated as a £30 phone.
 *
 * Used when extracting offers and again on the server so old extension payloads
 * (no `price_kind`) still get classified from title + price text.
 */
import { formatMonthlyPence, formatPence, parsePricePence, priceStringLooksMonthly } from "@/lib/money";
import type { Offer } from "@/lib/types";

export type PriceKind = "cash" | "monthly" | "unknown";

export type ClassifiedPrice = {
  price_kind: PriceKind;
  price_pence: number | null;
  monthly_pence: number | null;
  term_months: number | null;
  upfront_pence: number | null;
};

const MONTHLY_MARK =
  /\/\s*mo(?:nth)?s?\b|per\s+month|\ba\s+month\b|\bp\s*\/\s*m\b|(?:^|[^\w/])pm(?:$|[^\w])|\bmonthly\b/i;
const CONTRACT_MARK = /\bcontract\b|\bpay\s+monthly\b|\btariff\b|\bwith\s+airtime\b|\bsim\s+plan\b/i;
const TERM_MARK = /\b(\d{1,2})\s*-?\s*months?\b/i;
const UPFRONT_MARK = /(?:from\s+)?£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*upfront/i;
const MONTHLY_AMOUNT =
  /£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*(?:\/\s*mo(?:nth)?s?|per\s+month|a\s+month|p\s*\/\s*m|pm\b|monthly)/i;
const DUAL_CASH_MONTHLY =
  /£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s+(?:or|\/)\s+(?:from\s+)?£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?\s*(?:\/\s*mo(?:nth)?s?|per\s+month|a\s+month|p\s*\/\s*m|pm\b|monthly)/i;
const FIRST_POUND = /£\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/;

function toPence(pounds: string, frac: string | undefined): number {
  return Number(pounds.replace(/,/g, "")) * 100 + Number((frac ?? "").padEnd(2, "0"));
}

/** First £ amount in a blob, even when "/month" follows it. */
export function firstPoundPence(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.match(FIRST_POUND);
  if (match) return toPence(match[1], match[2]);
  return parsePricePence(input);
}

export function offerPriceHaystack(offer: {
  price: string;
  title?: string;
  summary?: string | null;
  specs?: string[];
  badge?: string | null;
  delivery?: string | null;
}): string {
  return [offer.price, offer.title, offer.summary, offer.badge, offer.delivery, ...(offer.specs ?? [])]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ");
}

export function classifyOfferPrice(offer: {
  price: string;
  title?: string;
  summary?: string | null;
  specs?: string[];
  badge?: string | null;
  delivery?: string | null;
}): ClassifiedPrice {
  const hay = offerPriceHaystack(offer);
  const termMatch = hay.match(TERM_MARK);
  const term_months = termMatch ? Number(termMatch[1]) : null;
  const upfrontMatch = hay.match(UPFRONT_MARK);
  const upfront_pence = upfrontMatch ? toPence(upfrontMatch[1], upfrontMatch[2]) : null;
  const monthlyMatch = hay.match(MONTHLY_AMOUNT);
  const monthlyFromText = monthlyMatch ? toPence(monthlyMatch[1], monthlyMatch[2]) : null;
  const dual = hay.match(DUAL_CASH_MONTHLY);
  const priceLooksMonthly = priceStringLooksMonthly(offer.price);
  const priceIsUpfront = /upfront/i.test(offer.price);
  const displayedCash = priceLooksMonthly || priceIsUpfront ? null : parsePricePence(offer.price);
  const displayedAmount = firstPoundPence(offer.price);
  const contractHint = CONTRACT_MARK.test(hay);
  const monthlyWords = MONTHLY_MARK.test(hay);

  if (dual) {
    return {
      price_kind: "cash",
      price_pence: toPence(dual[1], dual[2]),
      monthly_pence: toPence(dual[3], dual[4]),
      term_months,
      upfront_pence,
    };
  }

  if (priceLooksMonthly && displayedAmount !== null) {
    return {
      price_kind: "monthly",
      price_pence: null,
      monthly_pence: displayedAmount,
      term_months,
      upfront_pence,
    };
  }

  if (monthlyFromText !== null) {
    if (displayedCash !== null && displayedCash !== monthlyFromText) {
      return {
        price_kind: "cash",
        price_pence: displayedCash,
        monthly_pence: monthlyFromText,
        term_months,
        upfront_pence,
      };
    }
    return {
      price_kind: "monthly",
      price_pence: null,
      monthly_pence: monthlyFromText,
      term_months,
      upfront_pence,
    };
  }

  if (contractHint && monthlyWords && displayedAmount !== null) {
    if (displayedCash !== null && displayedCash !== displayedAmount) {
      return {
        price_kind: "cash",
        price_pence: displayedCash,
        monthly_pence: displayedAmount,
        term_months,
        upfront_pence,
      };
    }
    return {
      price_kind: "monthly",
      price_pence: null,
      monthly_pence: displayedAmount,
      term_months,
      upfront_pence,
    };
  }

  if (contractHint && displayedCash !== null) {
    // "contract" / "SIM plan" without a monthly figure stays cash if the price
    // looks like a one-off. Term may still be filled from "24 months".
    return {
      price_kind: "cash",
      price_pence: displayedCash,
      monthly_pence: null,
      term_months,
      upfront_pence,
    };
  }

  if (priceIsUpfront) {
    return {
      price_kind: monthlyWords ? "monthly" : "unknown",
      price_pence: null,
      monthly_pence: monthlyFromText,
      term_months,
      upfront_pence: upfront_pence ?? displayedAmount,
    };
  }

  if (displayedCash !== null && !monthlyWords) {
    return {
      price_kind: "cash",
      price_pence: displayedCash,
      monthly_pence: null,
      term_months,
      upfront_pence,
    };
  }

  if (displayedCash !== null) {
    // Monthly words in the haystack but no monthly amount — keep the one-off.
    return {
      price_kind: "cash",
      price_pence: displayedCash,
      monthly_pence: null,
      term_months,
      upfront_pence,
    };
  }

  if (displayedAmount !== null && monthlyWords) {
    return {
      price_kind: "monthly",
      price_pence: null,
      monthly_pence: displayedAmount,
      term_months,
      upfront_pence,
    };
  }

  return {
    price_kind: displayedAmount === null ? "unknown" : "cash",
    price_pence: displayedAmount,
    monthly_pence: null,
    term_months,
    upfront_pence,
  };
}

/**
 * Fill `price_kind` (and related fields) when the client omitted them.
 * A client that already set `price_kind` is trusted; we still refuse to treat
 * a monthly figure as `price_pence`.
 */
export function normalizeOfferPrice(offer: Offer): Offer {
  if (offer.price_kind !== undefined) {
    if (offer.price_kind === "monthly") {
      const monthly = offer.monthly_pence ?? firstPoundPence(offer.price);
      return { ...offer, price_pence: offer.price_pence ?? null, monthly_pence: monthly };
    }
    if (offer.price_kind === "cash" && (offer.price_pence === undefined || offer.price_pence === null)) {
      const classified = classifyOfferPrice(offer);
      return {
        ...offer,
        price_pence: classified.price_pence,
        monthly_pence: offer.monthly_pence ?? classified.monthly_pence,
        term_months: offer.term_months ?? classified.term_months,
        upfront_pence: offer.upfront_pence ?? classified.upfront_pence,
      };
    }
    return offer;
  }
  return { ...offer, ...classifyOfferPrice(offer) };
}

export function isMonthlyOnlyOffer(offer: Pick<Offer, "price_kind" | "price_pence" | "monthly_pence">): boolean {
  if (offer.price_kind === "monthly") return true;
  if (offer.price_kind === "cash") return false;
  return (offer.price_pence === null || offer.price_pence === undefined) && offer.monthly_pence != null;
}

export function isMonthlyOnlyItem(item: {
  price_kind?: PriceKind;
  price_pence: number | null;
  monthly_pence?: number | null;
}): boolean {
  if (item.price_kind === "monthly") return true;
  if (item.price_kind === "cash") return false;
  return item.price_pence === null && item.monthly_pence != null;
}

export function offerDisplayPrice(offer: Offer): string {
  const kind = offer.price_kind ?? classifyOfferPrice(offer).price_kind;
  if (kind === "monthly") {
    const monthly = offer.monthly_pence ?? firstPoundPence(offer.price);
    return monthly !== null ? formatMonthlyPence(monthly) : offer.price;
  }
  return offer.price;
}

export function monthlyMetaLabel(item: {
  term_months?: number | null;
  upfront_pence?: number | null;
  monthly_pence?: number | null;
  price_kind?: PriceKind;
  price_pence: number | null;
}): string | null {
  const bits: string[] = [];
  if (item.price_kind === "cash" && item.monthly_pence != null && item.price_pence !== null) {
    bits.push(`or ${formatMonthlyPence(item.monthly_pence)}`);
  }
  if (item.term_months) bits.push(`${item.term_months} months`);
  if (item.upfront_pence != null) bits.push(`${formatPence(item.upfront_pence)} upfront`);
  return bits.length > 0 ? bits.join(" · ") : null;
}
