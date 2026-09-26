/**
 * Deterministic stand-in for the Bedrock judge. Used when `COVERED_MOCK=1`, when
 * Bedrock rejects the call (credentials / model access), or per item when the
 * model's JSON fails validation twice.
 * Fixtures are keyed by id; live offers get a text heuristic and never a mislisting.
 */
import type { Decision, UserSettings } from "@/lib/types";
import type { ShortlistItem } from "@/lib/decision";
import { isProtected } from "@/lib/decision";
import { formatPence } from "@/lib/money";

const UK_RETAILERS = [
  "argos", "currys", "john lewis", "jd sports", "next", "marks", "m&s", "asos",
  "sports direct", "very", "boots", "tesco", "sainsbury", "asda", "b&q", "screwfix",
  "amazon.co.uk", "ebay.co.uk", "decathlon", "mountain warehouse", "go outdoors",
  "uniqlo", "h&m", "zara", "primark", "new look", "river island", "schuh", "footasylum",
  "smart cellular",
];

/** Merchant-side signals that this is a trader, not a private person. */
const TRADER_WORDS = [
  "reseller", "refurbish", "refurbished", "refurb", "second-hand", "secondhand",
  "pre-owned", "preowned",
];
const COMPANY_SUFFIX = /\b(ltd|limited|plc|llp)\b/i;

const BUSINESS_RIGHTS = ["14-day cancellation (CCR 2013)", "30-day fault refund (CRA 2015)"];

function fixtureDecision(item: ShortlistItem, items: ShortlistItem[], settings: UserSettings): Decision | null {
  switch (item.id) {
    case "mislisting-22":
      return {
        same_item: false,
        mislisting: true,
        photo_reason: "photo shows a nylon bomber jacket, not a fleece",
        sponsored: false,
        seller_type: "unclear",
        venue_trust: "marketplace_unprotected",
        rights: [],
        recommendation: "skip",
        reason: "Title says fleece hoodie; the photo shows a nylon bomber with a ribbed collar. Mislisting, dropped before price.",
      };
    case "private-28": {
      const protectedShop = items.find((i) => i.id === "shop-36" && i.price_pence !== null);
      const gap = protectedShop && protectedShop.price_pence !== null && item.price_pence !== null
        ? protectedShop.price_pence - item.price_pence
        : null;
      const cheapEnough = gap !== null && gap > settings.protection_premium_pence;
      return {
        same_item: true,
        mislisting: false,
        photo_reason: null,
        sponsored: false,
        seller_type: "private",
        venue_trust: "stranger",
        rights: ["as described only", "no cooling-off", "no CRA fault remedy"],
        recommendation: cheapEnough ? "buy" : "skip",
        reason: cheapEnough
          ? `Private seller, collection only: it is the fleece, and the saving${gap !== null ? ` of ${formatPence(gap)}` : ""} beats your premium, but a break is your problem.`
          : "Private seller, collection only: no returns and no Consumer Rights Act, so it only wins if the gap beats your premium.",
      };
    }
    case "shop-36":
      return {
        same_item: true,
        mislisting: false,
        photo_reason: null,
        sponsored: false,
        seller_type: "uk_business",
        venue_trust: "shop_checkout",
        rights: BUSINESS_RIGHTS,
        recommendation: "buy",
        reason: "UK retailer checkout with free 14-day returns: the fleece, with cooling-off and a 30-day fault refund.",
      };
    case "overseas-34":
      return {
        same_item: true,
        mislisting: false,
        photo_reason: null,
        sponsored: false,
        seller_type: "overseas_business",
        venue_trust: "marketplace_unprotected",
        rights: ["venue policy only, none written"],
        recommendation: "skip",
        reason: "Overseas stall, buyer pays return shipping to a CN warehouse, rating 3.1: a business badge is not protection.",
      };
    default:
      return null;
  }
}

function looksUkTrader(item: ShortlistItem): boolean {
  const merchant = item.merchant.toLowerCase();
  const domain = (item.venue_hint ?? "").toLowerCase();
  if (domain.endsWith(".co.uk") || domain.endsWith(".uk")) return true;
  if (UK_RETAILERS.some((name) => merchant.includes(name))) return true;
  if (COMPANY_SUFFIX.test(merchant)) return true;
  // Reseller / refurb / second-hand on the merchant name is still a trader.
  if (TRADER_WORDS.some((word) => merchant.includes(word))) return true;
  return false;
}

function thirdPartyMarket(item: ShortlistItem): boolean {
  const blob = `${item.merchant} ${item.venue_hint ?? ""}`.toLowerCase();
  return /amazon\.co\.uk\s*-/.test(blob) || blob.includes("-seller");
}

function heuristicDecision(item: ShortlistItem): Decision {
  const sponsored = item.section === "sponsored";
  const returnsText = (item.returns ?? "").toLowerCase();
  const returnsOk = returnsText.includes("free") || returnsText.includes("return");

  if (looksUkTrader(item)) {
    const reseller = TRADER_WORDS.some((word) => item.merchant.toLowerCase().includes(word));
    return {
      same_item: true,
      mislisting: false,
      photo_reason: null,
      sponsored,
      seller_type: "uk_business",
      venue_trust: thirdPartyMarket(item) ? "marketplace_protected" : "shop_checkout",
      rights: BUSINESS_RIGHTS,
      recommendation: "buy",
      reason: `${item.merchant} is a UK ${reseller ? "trader (reseller, not a private seller)" : "retailer checkout"}${returnsOk ? ` (${item.returns})` : ""}; cooling-off and CRA apply.${sponsored ? " This row is an ad; that is not why." : ""}`,
    };
  }
  return {
    same_item: true,
    mislisting: false,
    photo_reason: null,
    sponsored,
    seller_type: "unclear",
    venue_trust: "unclear",
    rights: [],
    recommendation: "ask",
    reason: `Cannot tell who ${item.merchant} is or where it ships from; no photos to check, so no premium is worth paying here.${sponsored ? " Sponsored row." : ""}`,
  };
}

export function mockDecision(item: ShortlistItem, items: ShortlistItem[], settings: UserSettings): Decision {
  return fixtureDecision(item, items, settings) ?? heuristicDecision(item);
}

export function mockJudge(
  items: ShortlistItem[],
  settings: UserSettings,
): { decisions: Record<string, Decision>; summary: string } {
  const decisions: Record<string, Decision> = {};
  for (const item of items) decisions[item.id] = mockDecision(item, items, settings);
  const values = Object.values(decisions);
  const mislistings = values.filter((d) => d.mislisting).length;
  const protectedCount = values.filter((d) => isProtected(d)).length;
  const summary = `${items.length} listings: ${mislistings} mislisting${mislistings === 1 ? "" : "s"} dropped from the photos, ${protectedCount} with real UK rights.`;
  return { decisions, summary };
}
