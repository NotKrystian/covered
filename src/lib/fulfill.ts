/**
 * Shared approve/debit path: write a receipt, debit the demo wallet, append
 * the order and an approve event. Used by POST /api/approve and limit fills.
 */
import { putReceipt } from "@/lib/s3";
import { ReceiptSchema, type Decision, type Listing, type Offer, type Receipt, type ReceiptSection } from "@/lib/types";
import { formatPence, parsePricePence } from "@/lib/money";
import { debitAndRecordPurchase, getMemory, publicMemory, saveMemory } from "@/lib/memory";
import { rewriteSummary } from "@/lib/memory/summary";

export type FulfillInput = {
  userId: string;
  query: string;
  chosen: Offer | Listing;
  decision: Decision;
  section: ReceiptSection;
  protection_premium_pence: number;
  chosen_id?: string;
};

export type FulfillOk = { ok: true; id: string; key: string; balance_pence: number };
export type FulfillErr = { ok: false; error: string; status: number };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function chosenTitle(chosen: Offer | Listing): string {
  return chosen.title;
}

function chosenMerchant(chosen: Offer | Listing): string {
  return chosen.merchant;
}

export function chosenPricePence(chosen: Offer | Listing): number | null {
  if ("price_pence" in chosen && typeof chosen.price_pence === "number") return chosen.price_pence;
  if ("price" in chosen && typeof chosen.price === "string") return parsePricePence(chosen.price);
  return null;
}

export async function fulfillPurchase(input: FulfillInput): Promise<FulfillOk | FulfillErr> {
  const parsed = ReceiptSchema.omit({ id: true, created_at: true }).safeParse({
    query: input.query,
    chosen: input.chosen,
    decision: input.decision,
    section: input.section,
    protection_premium_pence: input.protection_premium_pence,
  });
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Chosen listing is not a valid receipt" };
  }

  const pricePence = chosenPricePence(parsed.data.chosen);
  if (pricePence === null || pricePence < 0) {
    return { ok: false, status: 400, error: "Chosen listing has no price" };
  }

  const wallet = await getMemory(input.userId);
  if (wallet.balance_pence < pricePence) {
    return {
      ok: false,
      status: 402,
      error: `Wallet is short by ${formatPence(pricePence - wallet.balance_pence)}`,
    };
  }

  const receipt: Receipt = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...parsed.data,
  };
  const listingId = input.chosen_id ?? ("id" in receipt.chosen ? receipt.chosen.id : undefined);

  try {
    const { key } = await putReceipt(receipt);
    const paid = await debitAndRecordPurchase(input.userId, {
      pricePence,
      order: {
        id: receipt.id,
        t: receipt.created_at,
        query: receipt.query,
        title: chosenTitle(receipt.chosen),
        merchant: chosenMerchant(receipt.chosen),
        price_pence: pricePence,
        section: receipt.section,
        aftercare: [],
      },
      event: {
        kind: "approve",
        query: receipt.query,
        chosen_id: listingId,
        premium_pence: receipt.protection_premium_pence,
        note: `approved ${listingId ?? chosenMerchant(receipt.chosen)} (${chosenMerchant(receipt.chosen)} ${formatPence(pricePence)})`,
      },
    });
    if (!paid.ok) {
      return {
        ok: false,
        status: 402,
        error: `Wallet is short by ${formatPence(paid.short_by_pence)}`,
      };
    }
    const rewritten = await rewriteSummary(paid.memory);
    const saved = await saveMemory(input.userId, { ...paid.memory, summary: rewritten.summary });
    return {
      ok: true,
      id: receipt.id,
      key,
      balance_pence: publicMemory(saved).balance_pence,
    };
  } catch (err) {
    return { ok: false, status: 502, error: `S3 write failed: ${errorMessage(err)}` };
  }
}
