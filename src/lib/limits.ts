/**
 * Limit-buy: watch a query until a real listing is at or below £X, then
 * approve it through the same debit path as a manual Approve.
 *
 * Qualification is applyPremium (same pound rule as /api/decide), then the
 * limit: buy only if that chosen listing's price is <= max_price_pence.
 * A private/overseas listing is bought only when the premium would also
 * have allowed it. Mislistings never reach the price comparison.
 */
import { OfferSchema, type Offer } from "@/lib/types";
import { judge, researchProduct } from "@/lib/judge";
import { applyPremium, buildShortlistFromOffers } from "@/lib/decision";
import { formatPence } from "@/lib/money";
import { hydrateOfferPhotos } from "@/lib/reader/photos";
import { fulfillPurchase } from "@/lib/fulfill";
import {
  LIMITS_MAX,
  LimitSchema,
  getMemory,
  memoryPromptBlock,
  publicMemory,
  saveMemory,
  type Limit,
  type Memory,
} from "@/lib/memory";

export { LIMITS_MAX, LimitSchema };
export type { Limit };

export function stillAboveMessage(maxPricePence: number): string {
  return `still above ${formatPence(maxPricePence)}`;
}

function patchLimit(memory: Memory, id: string, patch: Partial<Limit>): Memory {
  return {
    ...memory,
    limits: memory.limits.map((limit) => (limit.id === id ? { ...limit, ...patch } : limit)),
  };
}

export type LimitRunResult =
  | { ok: true; limit: Limit; filled: boolean; balance_pence?: number }
  | { ok: false; error: string; status: number; limit?: Limit };

export async function runLimitAgainstOffers(
  userId: string,
  limitId: string,
  offers: Offer[],
): Promise<LimitRunResult> {
  const current = await getMemory(userId);
  const limit = current.limits.find((item) => item.id === limitId);
  if (!limit) return { ok: false, status: 404, error: "Limit not found" };
  if (limit.status !== "watching") {
    return { ok: false, status: 409, error: `Limit is ${limit.status}`, limit };
  }

  const checkedAt = new Date().toISOString();
  const parsedOffers = offers
    .map((offer) => OfferSchema.safeParse(offer))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);

  const researched = await researchProduct(limit.query);
  const hydrated = await hydrateOfferPhotos(parsedOffers);
  const built = buildShortlistFromOffers(hydrated, researched.brief);
  const memory = publicMemory(current);
  const judged = await judge(limit.query, current.settings, built.all, {
    memory: memoryPromptBlock(memory),
    brief: researched.brief,
  });
  const verdict = applyPremium(built.all, judged.decisions, current.settings);
  const chosen = built.all.find((item) => item.id === verdict.chosen_id);
  const chosenDecision = chosen ? judged.decisions[chosen.id] : undefined;

  if (
    !chosen ||
    !chosenDecision ||
    chosen.price_pence === null ||
    chosen.price_pence > limit.max_price_pence
  ) {
    const updated = await saveMemory(
      userId,
      patchLimit(current, limitId, {
        last_checked_at: checkedAt,
        last_result: stillAboveMessage(limit.max_price_pence),
      }),
    );
    const saved = updated.limits.find((item) => item.id === limitId);
    return { ok: true, limit: saved ?? { ...limit, last_checked_at: checkedAt }, filled: false };
  }

  if (current.balance_pence < chosen.price_pence) {
    const short = `Wallet is short by ${formatPence(chosen.price_pence - current.balance_pence)}`;
    const updated = await saveMemory(
      userId,
      patchLimit(current, limitId, { last_checked_at: checkedAt, last_result: short }),
    );
    const saved = updated.limits.find((item) => item.id === limitId);
    return { ok: true, limit: saved ?? { ...limit, last_checked_at: checkedAt, last_result: short }, filled: false };
  }

  const paid = await fulfillPurchase({
    userId,
    query: limit.query,
    chosen: chosen.raw.kind === "offer" ? chosen.raw.offer : chosen.raw.listing,
    decision: chosenDecision,
    section: chosen.section,
    protection_premium_pence: current.settings.protection_premium_pence,
    chosen_id: chosen.id,
  });

  if (!paid.ok) {
    if (paid.status === 402) {
      const afterShort = await getMemory(userId);
      const updated = await saveMemory(
        userId,
        patchLimit(afterShort, limitId, { last_checked_at: checkedAt, last_result: paid.error }),
      );
      const saved = updated.limits.find((item) => item.id === limitId);
      return { ok: true, limit: saved ?? { ...limit, last_checked_at: checkedAt, last_result: paid.error }, filled: false };
    }
    return { ok: false, status: paid.status, error: paid.error, limit };
  }

  const afterBuy = await getMemory(userId);
  const filled: Limit = {
    ...limit,
    status: "filled",
    last_checked_at: checkedAt,
    last_result: `bought ${chosen.merchant} at ${chosen.price_label}`,
    filled_order_id: paid.id,
  };
  const updated = await saveMemory(userId, patchLimit(afterBuy, limitId, filled));
  const saved = updated.limits.find((item) => item.id === limitId) ?? filled;
  return { ok: true, limit: saved, filled: true, balance_pence: paid.balance_pence };
}
