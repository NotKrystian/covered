/**
 * The UK-seller option. When the verdict picks a listing without UK buyer rights
 * (private, overseas, unverified), a buyer may still rather pay more to be able to send
 * it back. This finds the cheapest listing that is the item, is not a mislisting or a
 * monthly deal, and is a protected UK business (`isProtected`). Pure and client-safe.
 */
import { isProtected, survivorsForPremium, type DecideResponse, type ShortlistItem } from "@/lib/decision";

export type ProtectedAlternative = {
  item: ShortlistItem & { price_pence: number };
  /** How much more it costs than the verdict's pick (0 or more). */
  extra_pence: number;
};

export function protectedAlternative(
  result: Pick<DecideResponse, "listings" | "decisions" | "verdict">,
): ProtectedAlternative | null {
  const chosenId = result.verdict.chosen_id;
  const chosenDecision = chosenId ? result.decisions[chosenId] : undefined;
  const chosen = chosenId ? result.listings.find((i) => i.id === chosenId) : undefined;
  if (!chosen || !chosenDecision || isProtected(chosenDecision)) return null;

  let best: (ShortlistItem & { price_pence: number }) | null = null;
  for (const item of survivorsForPremium(result.listings, result.decisions)) {
    const d = result.decisions[item.id];
    if (!d || !isProtected(d) || item.price_pence === null) continue;
    if (!best || item.price_pence < best.price_pence) best = { ...item, price_pence: item.price_pence };
  }
  if (!best) return null;
  return { item: best, extra_pence: Math.max(0, best.price_pence - (chosen.price_pence ?? best.price_pence)) };
}
