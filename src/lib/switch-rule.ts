/**
 * The 14-day price-drop switch rule. Pure and client-safe.
 *
 * UK distance sales carry a 14-day right to cancel (Consumer Contracts Regulations
 * 2013). Covered turns that right into price protection: inside the window, if a
 * listing the judge rates as the same item from a UK business (so the buyer's rights
 * survive the move) is cheaper by at least their "switch if I clear" amount after
 * return postage, it offers to cancel the first order and buy the new one.
 *
 * The judge decides identity and seller; the pound comparison is here, in code.
 * A mislisting, a different item, or a private/overseas listing never qualifies,
 * however cheap. The first order must itself be from a UK business: a private
 * seller owes no cooling-off right, and an overseas one is hard to hold to it.
 */
import type { Decision, Offer, SellerType, UserSettings } from "@/lib/types";
import { isProtected, type ShortlistItem } from "@/lib/decision";
import type { OrderRecord } from "@/lib/memory";
import { formatPence } from "@/lib/money";

export const SWITCH_WINDOW_DAYS = 14;
const HOUR_MS = 3_600_000;
const UK_TIME_ZONE = "Europe/London";
/** A typical UK tracked return label for a small parcel. Always shown as an estimate. */
export const RETURN_POSTAGE_PENCE = 399;
/** How far the labelled demo simulation drops the price. */
export const SIMULATED_DROP = 0.35;

const ukParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  hourCycle: "h23",
});

function ukWallClock(instant: number): { y: number; m: number; d: number; hour: number } {
  const parts = ukParts.formatToParts(new Date(instant));
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { y: pick("year"), m: pick("month"), d: pick("day"), hour: pick("hour") };
}

/** 00:00 UK time on a calendar day. UK clocks change at 01:00 UTC, so midnight is 23:00 UTC (BST) or 00:00 UTC (GMT). */
function ukMidnight(y: number, m: number, d: number): number {
  const utcMidnight = Date.UTC(y, m - 1, d);
  const bst = ukWallClock(utcMidnight - HOUR_MS);
  return bst.d === d && bst.hour === 0 ? utcMidnight - HOUR_MS : utcMidnight;
}

/**
 * End of the switch window (exclusive): midnight UK time after the 14th UK calendar
 * day from the order date. The legal clock runs 14 days from the day after delivery,
 * and delivery is never before the order day, so counting from the order date ends at
 * or before the legal window and Covered never offers a switch the buyer cannot make.
 */
export function switchWindowEnds(order: Pick<OrderRecord, "t">): Date {
  const placed = new Date(order.t).getTime();
  if (!Number.isFinite(placed)) return new Date(Number.NaN);
  const day = ukWallClock(placed);
  const after = new Date(Date.UTC(day.y, day.m - 1, day.d + SWITCH_WINDOW_DAYS + 1));
  return new Date(ukMidnight(after.getUTCFullYear(), after.getUTCMonth() + 1, after.getUTCDate()));
}

/** Last UK calendar day of the window, e.g. "10 Oct". */
export function switchLastDayLabel(endsAt: string): string {
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends)) return "";
  return new Date(ends - 1).toLocaleDateString("en-GB", { timeZone: UK_TIME_ZONE, day: "numeric", month: "short" });
}

/** Why an order bought from this seller has no 14-day switch, or null when the right applies. */
export function coolingOffBlock(sellerType: SellerType | undefined): string | null {
  switch (sellerType) {
    case "uk_business":
      return null;
    case "private":
      return "private seller, so there is no 14-day right to cancel";
    case "overseas_business":
      return "overseas seller: the 14-day right is hard to enforce from the UK, so Covered will not switch it";
    case "unclear":
    case undefined:
      return "seller not confirmed as a UK business, so Covered will not switch it";
    default: {
      const unhandled: never = sellerType;
      return unhandled;
    }
  }
}

/** True while the order can still be switched: a UK business order, not cancelled, inside the window. */
export function isSwitchWatching(order: OrderRecord, now: Date = new Date()): boolean {
  if (order.cancelled_at || order.price_pence <= 0) return false;
  if (coolingOffBlock(order.seller_type) !== null) return false;
  const ends = switchWindowEnds(order).getTime();
  return Number.isFinite(ends) && now.getTime() < ends;
}

/** Cost of sending the first order back: nothing when it came with free returns. */
export function returnPostagePence(order: Pick<OrderRecord, "returns">): number {
  return /\bfree\b/i.test(order.returns ?? "") ? 0 : RETURN_POSTAGE_PENCE;
}

export type SwitchEvaluation =
  | { ok: true; item: ShortlistItem; decision: Decision; postage_pence: number; clear_pence: number; note: string }
  | { ok: false; note: string };

/**
 * Pick the cheapest listing the judge rates as the same item from a UK business, and
 * switch only if old price − new price − return postage clears the buyer's minimum.
 */
export function evaluateSwitch(
  order: OrderRecord,
  items: ShortlistItem[],
  decisions: Record<string, Decision>,
  settings: Pick<UserSettings, "switch_minimum_pence">,
): SwitchEvaluation {
  const postage = returnPostagePence(order);
  let best: ShortlistItem | null = null;
  for (const item of items) {
    const d = decisions[item.id];
    if (!d || !d.same_item || d.mislisting || !isProtected(d)) continue;
    if (item.price_pence === null || item.price_pence >= order.price_pence) continue;
    if (best === null || item.price_pence < (best.price_pence ?? Infinity)) best = item;
  }
  if (!best || best.price_pence === null) {
    return { ok: false, note: "no cheaper listing from a UK business" };
  }
  const clear = order.price_pence - best.price_pence - postage;
  const postageText = postage > 0 ? `after ${formatPence(postage)} return postage` : "with free returns";
  if (clear < settings.switch_minimum_pence) {
    return {
      ok: false,
      note: `best is ${best.merchant} at ${formatPence(best.price_pence)}: you would clear ${formatPence(clear)} ${postageText}, under your ${formatPence(settings.switch_minimum_pence)}`,
    };
  }
  const decision = decisions[best.id] as Decision;
  return {
    ok: true,
    item: best,
    decision,
    postage_pence: postage,
    clear_pence: clear,
    note: `${best.merchant} at ${formatPence(best.price_pence)}: you clear ${formatPence(clear)} ${postageText}`,
  };
}

/**
 * The labelled demo: the same listing at SIMULATED_DROP off. It still goes through the
 * real judge and the real rule; only the price is made up, and the UI says so.
 */
export function simulatedDropOffers(order: OrderRecord): Offer[] {
  const price = Math.round(order.price_pence * (1 - SIMULATED_DROP));
  return [
    {
      section: "browse",
      title: order.title,
      price: formatPence(price),
      price_pence: price,
      compare_at: formatPence(order.price_pence),
      merchant: order.merchant,
      badge: "Price drop",
      delivery: "Free delivery",
      returns: "Free 30-day returns",
      rating: null,
      rating_count: null,
      summary: null,
    },
  ];
}
