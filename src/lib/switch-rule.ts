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
import { isMonthlyOnlyItem, isProtected, type ShortlistItem } from "@/lib/decision";
import type { OrderRecord, SwitchOffer } from "@/lib/memory";
import { formatPence } from "@/lib/money";
import { shippingPence } from "@/lib/sort-listings";

export const SWITCH_WINDOW_DAYS = 14;
const HOUR_MS = 3_600_000;
const UK_TIME_ZONE = "Europe/London";
/** A typical UK tracked return label for a small parcel. Always shown as an estimate. */
export const RETURN_POSTAGE_PENCE = 399;
/** Demo market: how long after purchase the shop cuts its price. */
export const DEMO_DROP_AFTER_MS = 30_000;

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
  | {
      ok: true;
      item: ShortlistItem;
      decision: Decision;
      postage_pence: number;
      delivery_pence: number;
      clear_pence: number;
      /** True when the saving reaches the buyer's switch minimum: worth an alert. */
      clears_minimum: boolean;
      note: string;
    }
  | { ok: false; note: string };

/** Old price − new price − new delivery: how much less the item costs now. */
export function lessByPence(
  order: Pick<OrderRecord, "price_pence">,
  offer: Pick<SwitchOffer, "price_pence" | "delivery_pence">,
): number {
  return order.price_pence - offer.price_pence - offer.delivery_pence;
}

/**
 * Pick the listing the judge rates as the same item from a UK business with the lowest
 * price plus delivery. It is a find whenever old price − new price − new delivery − return
 * postage leaves the buyer something; the buyer's switch minimum only decides whether
 * Covered raises an alert. Delivery the grid does not state counts as £0.
 */
export function evaluateSwitch(
  order: OrderRecord,
  items: ShortlistItem[],
  decisions: Record<string, Decision>,
  settings: Pick<UserSettings, "switch_minimum_pence">,
): SwitchEvaluation {
  const postage = returnPostagePence(order);
  let best: { item: ShortlistItem; price: number; delivery: number } | null = null;
  for (const item of items) {
    const d = decisions[item.id];
    if (!d || !d.same_item || d.mislisting || !isProtected(d)) continue;
    if (isMonthlyOnlyItem(item) || item.price_pence === null) continue;
    const delivery = shippingPence(item.delivery) ?? 0;
    if (item.price_pence + delivery >= order.price_pence) continue;
    if (best === null || item.price_pence + delivery < best.price + best.delivery) {
      best = { item, price: item.price_pence, delivery };
    }
  }
  if (!best) return { ok: false, note: "nothing cheaper yet" };
  const less = order.price_pence - best.price - best.delivery;
  const clear = less - postage;
  if (clear <= 0) {
    return { ok: false, note: `${formatPence(less)} less at ${best.item.merchant}, but return postage costs more` };
  }
  const decision = decisions[best.item.id] as Decision;
  return {
    ok: true,
    item: best.item,
    decision,
    postage_pence: postage,
    delivery_pence: best.delivery,
    clear_pence: clear,
    clears_minimum: clear >= settings.switch_minimum_pence,
    note: `found for ${formatPence(less)} less at ${best.item.merchant}`,
  };
}

/**
 * The demo market: the shop cuts its own price once, 25–40% (fixed per order) and
 * priced the way shops price (£24.99, not £23.40), DEMO_DROP_AFTER_MS after purchase.
 * An order that is itself a switch never drops again.
 */
export function demoDrop(order: OrderRecord): { due_at: Date; price_pence: number } | null {
  if (order.switched_from || order.price_pence <= 0) return null;
  let hash = 0;
  for (const ch of order.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const raw = Math.round(order.price_pence * (1 - (25 + (hash % 16)) / 100));
  const pounds = Math.floor(raw / 100);
  return {
    due_at: new Date(new Date(order.t).getTime() + DEMO_DROP_AFTER_MS),
    price_pence: pounds >= 2 ? pounds * 100 - 1 : raw,
  };
}

/** True until a check has run since the order's demo drop came due (or would). */
export function demoDropPending(order: OrderRecord): boolean {
  const drop = demoDrop(order);
  if (!drop) return false;
  const checked = order.switch_check ? new Date(order.switch_check.checked_at).getTime() : NaN;
  return !(checked >= drop.due_at.getTime());
}

/**
 * The shop's cut listing once it is due, as the reader would see it on the shelf.
 * It joins the same check as a real read, so the real judge and the real rule decide.
 */
export function demoMarketOffers(order: OrderRecord, now: Date = new Date()): Offer[] {
  const drop = demoDrop(order);
  if (!drop || now.getTime() < drop.due_at.getTime()) return [];
  return [
    {
      section: "browse",
      title: order.title,
      price: formatPence(drop.price_pence),
      price_pence: drop.price_pence,
      compare_at: formatPence(order.price_pence),
      merchant: order.merchant,
      badge: "Price drop",
      delivery: null,
      returns: order.returns ?? null,
      rating: null,
      rating_count: null,
      summary: null,
    },
  ];
}
