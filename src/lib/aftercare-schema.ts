/**
 * Aftercare JSON shapes and the deterministic mock. Safe to import from the
 * orders chat — no Bedrock client.
 */
import { z } from "zod";
import { formatPence } from "@/lib/money";
import type { AftercareEntry, AftercareRemedy, OrderRecord } from "@/lib/memory";

const NOTE_MAX = 200;
export const AftercareRemedySchema = z.enum(["refund", "replace", "repair", "none"]);

export const AftercareHistoryTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(2000),
});
export type AftercareHistoryTurn = z.infer<typeof AftercareHistoryTurnSchema>;

export const AftercareAssistRequestSchema = z.object({
  order_id: z.string().max(80).optional(),
  message: z.string().min(1).max(2000),
  history: z.array(AftercareHistoryTurnSchema).max(20).default([]),
});
export type AftercareAssistRequest = z.infer<typeof AftercareAssistRequestSchema>;

export const AftercareAssistSchema = z.object({
  reply: z.string().min(1).max(4000),
  remedy: AftercareRemedySchema,
  right: z.string().min(1).max(240),
  draft_to_seller: z.string().max(4000).nullable(),
  refused: z.boolean(),
});
export type AftercareAssist = z.infer<typeof AftercareAssistSchema>;

const PRIVATE_MERCHANT =
  /facebook|marketplace|gumtree|vinted|depop|private seller|private\b|collection only/i;
const UK_SHOP =
  /jd sports|argos|currys|john lewis|next|marks|m&s|asos|sports direct|tesco|sainsbury|asda|amazon|decathlon|uniqlo|h&m|zara|boots|very|schuh|footasylum|b&q|screwfix/i;

export function daysSinceOrder(iso: string, now = Date.now()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

export function likelyPrivateSeller(merchant: string): boolean {
  if (UK_SHOP.test(merchant)) return false;
  return PRIVATE_MERCHANT.test(merchant);
}

function looksLikeFakeFault(message: string): boolean {
  const m = message.toLowerCase();
  const asksToLie =
    /tell them|say (that |it )?(it )?(arrived )?(broken|faulty|defective)|pretend|claim it('s| is| was) (broken|faulty)|arrived broken/.test(
      m,
    );
  const changeOfMind =
    /wore it|don't want|do not want|changed my mind|change of mind|don't like|do not like|not for me/.test(
      m,
    );
  return asksToLie && changeOfMind;
}

function looksLikeFault(message: string): boolean {
  if (looksLikeFakeFault(message)) return false;
  return /fault|faulty|broken|defect|doesn't work|does not work|zip|seam|hole|rip|tear|stain|arrived damaged|not working|won't |wont |failed|repair|fix it|replacement/.test(
    message.toLowerCase(),
  );
}

function looksLikeReplace(message: string): boolean {
  return /replac/.test(message.toLowerCase());
}

function looksLikeRepair(message: string): boolean {
  return /repair|fix/.test(message.toLowerCase());
}

function looksLikeReturn(message: string): boolean {
  return /return|refund|send (it )?back|cooling.?off|change of mind|don't want|do not want|wrong (size|colour|color)/.test(
    message.toLowerCase(),
  );
}

export function emptyOrdersAssist(): AftercareAssist {
  return {
    reply:
      "There is nothing to return yet. Approve a listing from the shop — that spends the bot wallet — and the order will show up here. Then I can draft a returns or fault letter for that seller. I will not email anyone for you.",
    remedy: "none",
    right: "No order yet",
    draft_to_seller: null,
    refused: false,
  };
}

function countingNote(order: OrderRecord): string {
  return `I am counting from the order date (${order.t.slice(0, 10)}), not a confirmed delivery.`;
}

function draftLetter(order: OrderRecord, body: string): string {
  return [
    `Hello ${order.merchant},`,
    "",
    `I bought "${order.title}" (${formatPence(order.price_pence)}) on ${order.t.slice(0, 10)} (order ${order.id}).`,
    "",
    body,
    "",
    "Please confirm how you will handle this.",
    "",
    "Thanks",
  ].join("\n");
}

/** Deterministic stand-in when COVERED_MOCK=1 or Bedrock is unusable. */
export function mockAftercareAssist(order: OrderRecord, message: string, now = Date.now()): AftercareAssist {
  const days = daysSinceOrder(order.t, now);
  const privateSeller = likelyPrivateSeller(order.merchant);
  const count = countingNote(order);

  if (looksLikeFakeFault(message)) {
    return {
      reply: `I will not draft that. Wanting to send it back after wearing it is a change of mind, not a fault, and I will not invent a defect. ${count}`,
      remedy: "none",
      right: "that is a change of mind",
      draft_to_seller: null,
      refused: true,
    };
  }

  if (privateSeller && (looksLikeFault(message) || looksLikeReturn(message) || looksLikeRepair(message))) {
    return {
      reply: `This looks like a private seller (${order.merchant}). There is no 14-day cooling-off and no Consumer Rights Act quality right. You can challenge a false description only. I will not draft a statutory letter. ${count}`,
      remedy: "none",
      right: "Private sale — as described only",
      draft_to_seller: null,
      refused: false,
    };
  }

  if (looksLikeFault(message)) {
    if (days <= 30 && !looksLikeRepair(message) && !looksLikeReplace(message)) {
      return {
        reply: `Within 30 days of the order you can reject a faulty item for a refund of ${formatPence(order.price_pence)}. A voucher or "15% off next time" is not that remedy. Copy the letter below and send it to ${order.merchant} yourself — I have not emailed them. ${count}`,
        remedy: "refund",
        right: "30-day short-term right to reject (CRA 2015)",
        draft_to_seller: draftLetter(
          order,
          "The item is faulty. Under the Consumer Rights Act 2015 short-term right to reject I am rejecting it and asking for a refund of the price. A voucher or discount is not an acceptable substitute.",
        ),
        refused: false,
      };
    }
    if (looksLikeReplace(message) || (!looksLikeRepair(message) && days > 30)) {
      const remedy: AftercareRemedy = looksLikeRepair(message) ? "repair" : "replace";
      return {
        reply: `${days > 30 ? "More than 30 days after the order, repair or replacement comes first" : "You asked for a replacement"}. The shop's own warranty does not replace the Consumer Rights Act. Copy the letter and send it to ${order.merchant} yourself — I have not emailed them. ${count}`,
        remedy,
        right:
          remedy === "repair"
            ? "CRA 2015 repair (after 30 days, repair or replacement first)"
            : "CRA 2015 replacement (after 30 days, repair or replacement first)",
        draft_to_seller: draftLetter(
          order,
          remedy === "repair"
            ? "The item is faulty. Under the Consumer Rights Act 2015 I am asking you to repair it in a reasonable time and without significant inconvenience. If that fails I will seek a refund."
            : "The item is faulty. Under the Consumer Rights Act 2015 I am asking you to replace it. If that fails or takes too long I will seek a refund.",
        ),
        refused: false,
      };
    }
    return {
      reply: `The item is faulty. After 30 days the first step is a repair or replacement; you asked for a repair. Copy the letter and send it to ${order.merchant} yourself — I have not emailed them. ${count}`,
      remedy: "repair",
      right: "CRA 2015 repair (after 30 days, repair or replacement first)",
      draft_to_seller: draftLetter(
        order,
        "The item is faulty. Under the Consumer Rights Act 2015 I am asking you to repair it in a reasonable time. If that fails I will seek a refund.",
      ),
      refused: false,
    };
  }

  if (looksLikeReturn(message) || looksLikeReplace(message) || looksLikeRepair(message)) {
    if (days > 14) {
      return {
        reply: `A change-of-mind cancel is 14 days from the day after delivery. Counting from the order date that window looks closed (${days} days). I will not invent a fault. If it is actually faulty, say what is wrong. ${count}`,
        remedy: "none",
        right: "14-day cooling-off window looks closed",
        draft_to_seller: null,
        refused: false,
      };
    }
    return {
      reply: `UK business, online: you have 14 days from the day after delivery to cancel, then 14 days to send it back. They must refund the price and standard delivery. Return postage is on you if they said so. No restocking fee. Copy the letter and send it to ${order.merchant} yourself — I have not emailed them. ${count}`,
      remedy: "refund",
      right: "14-day cooling-off (CCR 2013)",
      draft_to_seller: draftLetter(
        order,
        "I am cancelling this distance contract under the Consumer Contracts Regulations 2013. Please refund the price and standard delivery. I will send the item back within 14 days.",
      ),
      refused: false,
    };
  }

  return {
    reply: `This order is "${order.title}" from ${order.merchant} for ${formatPence(order.price_pence)}, placed ${order.t.slice(0, 10)}. Say if you want to return it (change of mind), get a replacement, or get a repair because it is faulty. ${count}`,
    remedy: "none",
    right: "Waiting for what you want",
    draft_to_seller: null,
    refused: false,
  };
}

export function aftercareOutcomeLine(result: AftercareAssist): string {
  if (result.refused) {
    return /change of mind/i.test(result.right)
      ? "Refused: that is a change of mind"
      : `Refused: ${result.right}`;
  }
  switch (result.remedy) {
    case "refund":
      return /30/.test(result.right)
        ? "Refund under the 30-day right"
        : /14|cooling/i.test(result.right)
          ? "Refund under the 14-day cooling-off"
          : `Refund: ${result.right}`;
    case "replace":
      return "Replacement under the Consumer Rights Act";
    case "repair":
      return "Repair under the Consumer Rights Act";
    case "none":
      return result.right;
    default: {
      const never: never = result.remedy;
      return String(never);
    }
  }
}

export function aftercareNote(result: AftercareAssist): string {
  const prefix = result.refused ? "refused" : result.remedy;
  return `${prefix}: ${result.right}`.slice(0, NOTE_MAX);
}

export function toAftercareEntry(result: AftercareAssist, t = new Date().toISOString()): AftercareEntry {
  return {
    t,
    remedy: result.remedy,
    refused: result.refused,
    note: aftercareNote(result),
  };
}

export function describeOrder(order: OrderRecord): string {
  return [
    `id: ${order.id}`,
    `title: ${order.title}`,
    `merchant: ${order.merchant}`,
    `price: ${formatPence(order.price_pence)}`,
    `query: ${order.query}`,
    `created_at: ${order.t}`,
    `delivery_date: unknown — count from created_at and say so`,
    order.aftercare.length > 0
      ? `prior aftercare: ${order.aftercare.map((a) => `${a.t.slice(0, 10)} ${a.refused ? "refused" : a.remedy} (${a.note})`).join("; ")}`
      : "prior aftercare: none",
  ].join("\n");
}

export function describeSettings(premiumPence: number, switchMinimumPence: number, approval: string): string {
  return `protection premium ${formatPence(premiumPence)}, switch minimum ${formatPence(switchMinimumPence)}, approval ${approval}`;
}

export function describeHistory(history: AftercareHistoryTurn[]): string {
  if (history.length === 0) return "(none)";
  return history.map((turn) => `${turn.role}: ${turn.text}`).join("\n");
}
