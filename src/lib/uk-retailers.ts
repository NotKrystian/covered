/**
 * Well-known UK retailers selling in their own name. A listing from one of these is a
 * UK business behind a shop checkout whatever the judge said, so the 14-day cancellation
 * and 30-day fault refund apply. This stops false negatives ("seller unclear" on Tesco)
 * without trusting the judge less anywhere else.
 *
 * Matching is on the whole shop name after dropping "www.", ".co.uk", "Ltd", "UK",
 * "Store" and the like, never a substring: "Next" is a retailer, "Next Day Gadgets Ltd"
 * is not. Anything that reads as a third party ("seller", "marketplace", "via", a
 * "·"-joined storefront) stays with the judge: a marketplace seller can be anyone.
 *
 * Only seller facts change. `same_item`, `mislisting` and the photo reason never do,
 * so a mislisting from Argos is still dropped before any price is compared.
 */
import type { Decision } from "@/lib/types";
import { isProtected, type ShortlistItem } from "@/lib/decision";

/** Shop names as `retailerKey` leaves them. */
const UK_RETAILERS = new Set([
  // Supermarkets and general
  "tesco", "sainsburys", "asda", "morrisons", "waitrose", "ocado", "co op", "iceland",
  "marks and spencer", "m and s", "argos", "boots", "superdrug", "amazon", "wilko",
  "robert dyas", "lakeland", "dunelm", "john lewis", "john lewis and partners",
  "next", "very", "littlewoods", "debenhams", "selfridges", "harrods", "harvey nichols",
  "house of fraser", "tk maxx", "matalan", "whsmith", "wh smith", "waterstones",
  // Electricals, computing and phones
  "currys", "currys pc world", "ao", "richer sounds", "ebuyer", "laptops direct",
  "overclockers", "hughes", "sky", "bt", "ee", "vodafone", "o2", "three", "virgin media",
  "giffgaff", "apple", "samsung",
  // Home, DIY and garden
  "b and q", "wickes", "screwfix", "toolstation", "homebase", "halfords", "ikea", "wayfair", "dfs",
  // Fashion, sport and outdoor
  "jd sports", "sports direct", "footasylum", "schuh", "office", "clarks", "asos", "boohoo",
  "new look", "river island", "h and m", "zara", "uniqlo", "primark", "decathlon",
  "mountain warehouse", "go outdoors", "cotswold outdoor", "blacks", "millets",
  // Toys, pets
  "smyths", "smyths toys", "entertainer", "hamleys", "pets at home",
]);

/** A third party selling through a big name: leave the call to the judge. */
const THIRD_PARTY = /seller|marketplace|\bvia\b|·|\|/i;
/** The same brand's non-UK storefront (amazon.com, amazon.de, …) is not a UK business. */
const NOT_UK = /\bamazon\.com\b|\.(de|fr|es|it|nl|ie|us|com\.au|ca)\b/i;

/** The shop name reduced to what the whitelist compares: lower case, no domain, no "Ltd"/"UK"/"Store". */
export function retailerKey(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/\bwww\./g, "")
    .replace(/\.(co\.uk|org\.uk|com|uk|net)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|ltd|limited|plc|uk|gb|store|shop|online|official)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the shop is a whitelisted UK retailer selling in its own name. */
export function isKnownUkRetailer(merchant: string): boolean {
  if (THIRD_PARTY.test(merchant) || NOT_UK.test(merchant)) return false;
  return UK_RETAILERS.has(retailerKey(merchant));
}

const UK_RIGHTS = ["14-day cancellation (CCR 2013)", "30-day fault refund (CRA 2015)"];

/**
 * Promote whitelisted retailers the judge under-rated to a protected UK business.
 * Returns the same decision objects when nothing changes, plus the shops promoted.
 */
export function applyRetailerWhitelist(
  items: ShortlistItem[],
  decisions: Record<string, Decision>,
): { decisions: Record<string, Decision>; promoted: string[] } {
  const next: Record<string, Decision> = { ...decisions };
  const promoted: string[] = [];
  for (const item of items) {
    const d = decisions[item.id];
    if (!d || isProtected(d) || !isKnownUkRetailer(item.merchant)) continue;
    const usable = d.same_item && !d.mislisting;
    next[item.id] = {
      ...d,
      seller_type: "uk_business",
      venue_trust: "shop_checkout",
      rights: UK_RIGHTS,
      // Keep the judge's sentence when it explains a drop; otherwise say why the rights apply.
      reason: usable
        ? `${item.merchant} is a known UK retailer: 14-day cancellation and a 30-day fault refund.`
        : d.reason,
    };
    if (!promoted.includes(item.merchant)) promoted.push(item.merchant);
  }
  return { decisions: next, promoted };
}
