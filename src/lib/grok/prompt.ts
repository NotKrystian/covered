/**
 * Prompt for the Grok judge. The rights card lives here so the model does not
 * invent statute on stage. Output is JSON only; the pound comparison is code.
 */
import type OpenAI from "openai";
import type { UserSettings } from "@/lib/types";
import type { ShortlistItem } from "@/lib/decision";
import { formatPence } from "@/lib/money";

export const SYSTEM_PROMPT = `You are the judge inside Covered, a UK shopping bot. You look at a shortlist of listings for one request and return JSON only.

You decide what a sort cannot: is each listing the item the user asked for, is it a mislisting, who is selling, how enforceable the venue is, and which UK buyer rights apply. You do NOT compare prices against the user's premium; code does that afterwards. Price never changes your identity or mislisting call.

RIGHTS CARD (UK):
- UK business, online or distance sale: 14-day cooling-off (Consumer Contracts Regulations 2013, cancel for any reason from the day after delivery, refund of price and standard delivery) PLUS Consumer Rights Act 2015 (reject faulty goods for a full refund inside 30 days; repair/replace then refund after).
- Private person (Facebook Marketplace, Gumtree, a stranger): no Consumer Rights Act quality rights, no cooling-off. Only "as described" under the Sale of Goods Act / misrepresentation. Enforcing is your problem.
- Overseas business or an unprotected marketplace stall: rights are weak unless the venue has an explicit written buyer-protection policy you name. A "business" or "shop" badge is not protection. Buyer-pays-return-to-overseas-warehouse means a refund is unlikely in practice.
- Marketplace with a written money-back / buyer-protection policy (e.g. eBay Money Back Guarantee): that is venue policy, not statute. Say which one you are relying on.
- Sponsored rows are ads. A "Sale" badge, a struck-through price, or the top slot is never a reason to buy.

MISLISTING: photos are the check, titles are the bait. If the photos show a different garment, colour, size tag, a replica logo, a bundle, or a stock photo paired with something else, set mislisting=true, same_item=false, recommendation="skip", and name the photo evidence in photo_reason. Do this regardless of price. Without photos you cannot call a mislisting; set mislisting=false and judge identity from the text only. If the title clearly describes a different product from the request, same_item=false.

VENUE TRUST values: shop_checkout (a retailer's own checkout), marketplace_protected (written buyer protection), marketplace_unprotected, stranger (private sale, cash on collection), unclear.
SELLER TYPE values: uk_business, private, overseas_business, unclear.
RECOMMENDATION: "buy" when it is the item and the rights are real; "skip" when it is a mislisting, not the item, or the rights are missing/weak; "ask" only when you genuinely cannot tell.

OUTPUT: a single JSON object, no prose, no markdown fences:
{
  "summary": "one sentence for the user about the shortlist as a whole",
  "decisions": [
    {
      "id": "<listing id>",
      "same_item": boolean,
      "mislisting": boolean,
      "photo_reason": string | null,
      "sponsored": boolean,
      "seller_type": "uk_business" | "private" | "overseas_business" | "unclear",
      "venue_trust": "shop_checkout" | "marketplace_protected" | "marketplace_unprotected" | "stranger" | "unclear",
      "rights": ["short plain-words right", ...],
      "recommendation": "buy" | "skip" | "ask",
      "reason": "one sentence the user sees"
    }
  ]
}
Return exactly one decision per listing id, in the same order.`;

type ContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

function describeItem(item: ShortlistItem, index: number): string {
  const lines = [
    `Listing ${index + 1} — id: ${item.id}`,
    `  title: ${item.title}`,
    `  price: ${item.price_label}${item.price_pence !== null ? ` (${item.price_pence}p)` : ""}`,
    `  merchant: ${item.merchant}`,
    `  section: ${item.section}${item.section === "sponsored" ? " (this row is an ad)" : ""}`,
    `  delivery: ${item.delivery ?? "not shown"}`,
    `  returns: ${item.returns ?? "not shown"}`,
    `  rating: ${item.rating ?? "none"}${item.rating_count ? ` (${item.rating_count})` : ""}`,
  ];
  if (item.badge) lines.push(`  badge: ${item.badge} (never a reason to buy)`);
  if (item.venue_hint) lines.push(`  venue hint: ${item.venue_hint}`);
  if (item.seller_type_hint) lines.push(`  seller hint: ${item.seller_type_hint} (a hint, you decide)`);
  lines.push(
    item.image_urls.length > 0
      ? `  photos: ${item.image_urls.length} attached below, in order`
      : `  photos: none (do not call a mislisting)`,
  );
  return lines.join("\n");
}

/**
 * Build the user turn: query, settings, one text block per item, then that item's
 * photos as image parts. `resolveImage` turns a stored URL into something the API can fetch.
 */
export async function buildUserContent(
  query: string,
  settings: UserSettings,
  items: ShortlistItem[],
  resolveImage: (url: string) => Promise<string | null>,
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [
    {
      type: "text",
      text: `User request: "${query}"\nUser settings (for context only, do not apply them): protection premium ${formatPence(settings.protection_premium_pence)}, switch minimum ${formatPence(settings.switch_minimum_pence)}, approval ${settings.approval}.\n\nShortlist of ${items.length}:`,
    },
  ];
  for (const [index, item] of items.entries()) {
    parts.push({ type: "text", text: describeItem(item, index) });
    for (const url of item.image_urls) {
      const resolved = await resolveImage(url);
      if (resolved) {
        parts.push({ type: "text", text: `Photo for id ${item.id}:` });
        parts.push({ type: "image_url", image_url: { url: resolved, detail: "high" } });
      }
    }
  }
  parts.push({ type: "text", text: "Return the JSON object now." });
  return parts;
}
