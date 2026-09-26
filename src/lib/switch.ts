/**
 * 14-day price-drop switch: server side. The rule is `switch-rule.ts`; this file
 * runs a check through the same research, judge and photo pipeline as a search,
 * stores the result on the order, and performs an accepted switch:
 *
 *   1. cancel the first order under the 14-day right and refund it to the demo
 *      wallet (minus return postage), noted in the order's aftercare,
 *   2. buy the new listing through `fulfillPurchase` (receipt, debit, order, event),
 *   3. link the two orders. If step 2 fails, step 1 is rolled back.
 */
import { OfferSchema, type Offer } from "@/lib/types";
import { buildShortlistFromOffers } from "@/lib/decision";
import { formatPence } from "@/lib/money";
import { judge, researchProduct } from "@/lib/judge";
import { hydrateOfferPhotos } from "@/lib/reader/photos";
import { fulfillPurchase } from "@/lib/fulfill";
import {
  AFTERCARE_MAX,
  getMemory,
  memoryPromptBlock,
  publicMemory,
  saveMemory,
  type Memory,
  type OrderRecord,
  type SwitchCheck,
} from "@/lib/memory";
import {
  evaluateSwitch,
  isSwitchWatching,
  returnPostagePence,
  switchWindowEnds,
} from "@/lib/switch-rule";

/** One order as the watch list shows it. */
export type SwitchWatch = {
  order: OrderRecord;
  /** ISO 8601: when the 14-day window closes. */
  ends_at: string;
  postage_pence: number;
  /** False once switched away or past the window. */
  watching: boolean;
};

/** Orders still inside their window, including ones already switched away (newest first). */
export function switchWatches(memory: Memory, now: Date = new Date()): SwitchWatch[] {
  return [...memory.orders]
    .reverse()
    .filter((order) => switchWindowEnds(order).getTime() > now.getTime())
    .map((order) => ({
      order,
      ends_at: switchWindowEnds(order).toISOString(),
      postage_pence: returnPostagePence(order),
      watching: isSwitchWatching(order, now),
    }));
}

function patchOrder(memory: Memory, orderId: string, patch: (order: OrderRecord) => OrderRecord): Memory {
  return { ...memory, orders: memory.orders.map((order) => (order.id === orderId ? patch(order) : order)) };
}

export type SwitchRunResult =
  | { ok: true; order: OrderRecord; found: boolean }
  | { ok: false; status: number; error: string };

/**
 * Judge a fresh grid for the order's query and store the outcome on the order.
 * `simulated` marks the labelled demo grid so the UI never passes it off as real.
 */
export async function runSwitchCheck(
  userId: string,
  orderId: string,
  offers: Offer[],
  options: { simulated: boolean },
): Promise<SwitchRunResult> {
  const current = await getMemory(userId);
  const order = current.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (!isSwitchWatching(order)) {
    return { ok: false, status: 409, error: order.cancelled_at ? "Order was already switched" : "Order is past its 14-day window" };
  }

  const parsed = offers
    .map((offer) => OfferSchema.safeParse(offer))
    .filter((result) => result.success)
    .map((result) => result.data);
  const checkedAt = new Date().toISOString();
  const prefix = options.simulated ? "demo simulation: " : "";

  let check: SwitchCheck;
  if (parsed.length === 0) {
    check = { checked_at: checkedAt, note: `${prefix}no listings came back`, offer: null };
  } else {
    const researched = await researchProduct(order.query);
    const hydrated = await hydrateOfferPhotos(parsed);
    const built = buildShortlistFromOffers(hydrated, researched.brief);
    const judged = await judge(order.query, current.settings, built.all, {
      memory: memoryPromptBlock(publicMemory(current)),
      brief: researched.brief,
    });
    const verdict = evaluateSwitch(order, built.all, judged.decisions, current.settings);
    if (verdict.ok && verdict.item.price_pence !== null) {
      const chosen =
        verdict.item.raw.kind === "offer"
          ? { ...verdict.item.raw.offer, image_data_url: null } // keep the memory item small
          : verdict.item.raw.listing;
      check = {
        checked_at: checkedAt,
        note: `${prefix}${verdict.note}`,
        offer: {
          found_at: checkedAt,
          simulated: options.simulated,
          chosen_id: verdict.item.id,
          chosen,
          decision: verdict.decision,
          section: verdict.item.section,
          title: verdict.item.title,
          merchant: verdict.item.merchant,
          price_pence: verdict.item.price_pence,
          postage_pence: verdict.postage_pence,
          clear_pence: verdict.clear_pence,
        },
      };
    } else {
      check = { checked_at: checkedAt, note: `${prefix}${verdict.note}`, offer: null };
    }
  }

  // Re-read before writing: the judge call can take a while.
  const latest = await getMemory(userId);
  const saved = await saveMemory(userId, patchOrder(latest, orderId, (o) => ({ ...o, switch_check: check })));
  const updated = saved.orders.find((o) => o.id === orderId) ?? { ...order, switch_check: check };
  return { ok: true, order: updated, found: check.offer !== null };
}

export type SwitchAcceptResult =
  | { ok: true; new_order_id: string; refund_pence: number; clear_pence: number; balance_pence: number }
  | { ok: false; status: number; error: string };

export async function acceptSwitch(userId: string, orderId: string): Promise<SwitchAcceptResult> {
  const current = await getMemory(userId);
  const order = current.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (!isSwitchWatching(order)) {
    return { ok: false, status: 409, error: order.cancelled_at ? "Order was already switched" : "Order is past its 14-day window" };
  }
  const offer = order.switch_check?.offer;
  if (!offer) return { ok: false, status: 409, error: "No switch on offer for this order" };

  const refund = Math.max(0, order.price_pence - offer.postage_pence);
  if (current.balance_pence + refund < offer.price_pence) {
    return {
      ok: false,
      status: 402,
      error: `Wallet is short by ${formatPence(offer.price_pence - current.balance_pence - refund)}`,
    };
  }

  // 1. Cancel under the 14-day right and refund to the demo wallet.
  const cancelledAt = new Date().toISOString();
  const postageText = offer.postage_pence > 0 ? ` after ${formatPence(offer.postage_pence)} return postage` : "";
  await saveMemory(userId, {
    ...patchOrder(current, orderId, (o) => ({
      ...o,
      cancelled_at: cancelledAt,
      refund_pence: refund,
      aftercare: [
        ...(o.aftercare ?? []),
        {
          t: cancelledAt,
          remedy: "refund" as const,
          refused: false,
          note: `Cancelled under the 14-day right (CCR 2013) to switch to ${offer.merchant} at ${formatPence(offer.price_pence)}. Refund ${formatPence(refund)}${postageText}.`,
        },
      ].slice(-AFTERCARE_MAX),
    })),
    balance_pence: current.balance_pence + refund,
  });

  // 2. Buy the new listing through the shared purchase path.
  const paid = await fulfillPurchase({
    userId,
    query: order.query,
    chosen: offer.chosen,
    decision: offer.decision,
    section: offer.section,
    protection_premium_pence: current.settings.protection_premium_pence,
    chosen_id: offer.chosen_id,
  });
  if (!paid.ok) {
    const again = await getMemory(userId);
    await saveMemory(userId, {
      ...patchOrder(again, orderId, (o) => ({
        ...o,
        cancelled_at: undefined,
        refund_pence: undefined,
        aftercare: (o.aftercare ?? []).filter((entry) => entry.t !== cancelledAt),
      })),
      balance_pence: Math.max(0, again.balance_pence - refund),
    });
    return { ok: false, status: paid.status, error: paid.error };
  }

  // 3. Link the two orders.
  const after = await getMemory(userId);
  const linked = await saveMemory(userId, {
    ...after,
    orders: after.orders.map((o) => {
      if (o.id === orderId) {
        return {
          ...o,
          switched_to: paid.id,
          switch_check: { checked_at: cancelledAt, note: `switched to ${offer.merchant}`, offer: null },
        };
      }
      if (o.id === paid.id) return { ...o, switched_from: orderId };
      return o;
    }),
  });
  return {
    ok: true,
    new_order_id: paid.id,
    refund_pence: refund,
    clear_pence: offer.clear_pence,
    balance_pence: linked.balance_pence,
  };
}
