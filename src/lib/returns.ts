/**
 * One-click returns for approved orders. Pure and client-safe: the orders popup
 * shows these options and POST /api/orders/return performs one, re-checking the
 * same rules on the server.
 *
 * UK rules (same as the aftercare assistant's rights card):
 * - Change of mind, UK business, online: 14 days to cancel (Consumer Contracts
 *   Regulations 2013). Refund of the price; return postage is on the buyer unless
 *   the shop offers free returns.
 * - Faulty, within 30 days: reject for a full refund (Consumer Rights Act 2015). The
 *   trader pays to take a faulty item back, so no postage is deducted.
 * - Faulty, any time: repair or replacement (CRA 2015). No money moves here.
 * - Private seller: no cooling-off and no CRA quality right, so no options.
 *
 * Counted from the order date, not a confirmed delivery, which ends each window
 * earlier than the law does, never later.
 */
import type { OrderRecord, SwitchOffer } from "@/lib/memory";
import { formatPence } from "@/lib/money";
import { daysSinceOrder, likelyPrivateSeller } from "@/lib/aftercare-schema";
import { isSwitchWatching, returnPostagePence } from "@/lib/switch-rule";

export const COOLING_OFF_DAYS = 14;
export const SHORT_TERM_REJECT_DAYS = 30;
const DAY_MS = 86_400_000;

export type ReturnKind = "return" | "fault_refund" | "replace" | "repair";
/** Every email the returns popup can send: a switch is a 14-day cancellation plus a rebuy. */
export type EmailKind = ReturnKind | "switch";

export type ReturnEmail = { to: string; subject: string; body: string };

export type ReturnOption = {
  kind: ReturnKind;
  /** Button text. */
  label: string;
  /** The right relied on, in plain words. */
  right: string;
  /** Wallet refund for this path; null when no money moves (repair, replacement). */
  refund_pence: number | null;
  postage_pence: number;
};

export type ReturnState =
  | { kind: "private"; note: string }
  | { kind: "done"; note: string }
  | { kind: "open"; days: number; options: ReturnOption[]; note: string | null };

/** What has already happened to the order, if anything. */
export function returnStatus(order: OrderRecord): string | null {
  if (order.cancelled_at) {
    if (order.switched_to) return "switched";
    return "returned";
  }
  const last = [...(order.aftercare ?? [])].reverse().find((entry) => !entry.refused);
  if (last?.remedy === "repair" && /requested/i.test(last.note)) return "repair requested";
  if (last?.remedy === "replace" && /requested/i.test(last.note)) return "replacement requested";
  return null;
}

/** The actions this order allows right now. */
export function returnState(order: OrderRecord, now: number = Date.now()): ReturnState {
  const status = returnStatus(order);
  if (status === "returned" || status === "switched") {
    return {
      kind: "done",
      note:
        status === "switched"
          ? "Cancelled under the 14-day right when Covered switched you to a cheaper listing."
          : `Returned. ${order.refund_pence !== undefined ? `${formatPence(order.refund_pence)} went back to your demo wallet.` : ""}`.trim(),
    };
  }
  if (likelyPrivateSeller(order.merchant)) {
    return {
      kind: "private",
      note: `${order.merchant} looks like a private seller: no 14-day cooling-off and no Consumer Rights Act quality right. You can only challenge a false description.`,
    };
  }

  const days = daysSinceOrder(order.t, now);
  const postage = returnPostagePence(order);
  const options: ReturnOption[] = [];
  if (days <= COOLING_OFF_DAYS) {
    options.push({
      kind: "return",
      label: `Return it for ${formatPence(Math.max(0, order.price_pence - postage))}`,
      right: "14-day cooling-off (Consumer Contracts Regulations 2013)",
      refund_pence: Math.max(0, order.price_pence - postage),
      postage_pence: postage,
    });
  }
  if (days <= SHORT_TERM_REJECT_DAYS) {
    options.push({
      kind: "fault_refund",
      label: `It's faulty: full refund of ${formatPence(order.price_pence)}`,
      right: "30-day right to reject (Consumer Rights Act 2015)",
      refund_pence: order.price_pence,
      postage_pence: 0,
    });
  }
  options.push(
    {
      kind: "replace",
      label: "It's faulty: send a replacement",
      right: "Replacement (Consumer Rights Act 2015)",
      refund_pence: null,
      postage_pence: 0,
    },
    {
      kind: "repair",
      label: "It's faulty: repair it",
      right: "Repair (Consumer Rights Act 2015)",
      refund_pence: null,
      postage_pence: 0,
    },
  );
  const note =
    days > COOLING_OFF_DAYS
      ? `The 14-day change-of-mind window has closed (${days} days since the order). A fault still has a remedy.`
      : status
        ? `Already ${status}.`
        : null;
  return { kind: "open", days, options, note };
}

/** Last day to post it back: 14 days after cancelling (CCR 2013). */
export function sendBackBy(cancelledAt: string): string {
  const d = new Date(new Date(cancelledAt).getTime() + COOLING_OFF_DAYS * DAY_MS);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The record kept on the order (and what would go to the shop). ≤ 200 characters. */
export function returnNote(order: OrderRecord, option: ReturnOption): string {
  switch (option.kind) {
    case "return":
      return `Returned under the 14-day cooling-off (CCR 2013). Refund ${formatPence(option.refund_pence ?? 0)}${option.postage_pence ? ` after ${formatPence(option.postage_pence)} return postage` : ""}.`;
    case "fault_refund":
      return `Rejected as faulty within 30 days (CRA 2015). Full refund ${formatPence(order.price_pence)}; the shop pays return postage.`;
    case "replace":
      return "Replacement requested for a fault (CRA 2015). If it fails or is too slow, a refund follows.";
    case "repair":
      return "Repair requested for a fault (CRA 2015). If it fails or is too slow, a refund follows.";
    default: {
      const never: never = option.kind;
      return String(never);
    }
  }
}

/** The cheaper listing found for this order, while it can still be switched. */
export function switchOfferFor(order: OrderRecord, now: Date = new Date()): SwitchOffer | null {
  return isSwitchWatching(order, now) ? (order.switch_check?.offer ?? null) : null;
}

/**
 * The email to the shop for this path, in the buyer's name. A switch sends a plain
 * 14-day cancellation: the law needs no reason, so the cheaper listing is not mentioned.
 */
export function returnEmail(order: OrderRecord, kind: EmailKind, buyerName?: string | null): ReturnEmail {
  const bought = new Date(order.t);
  const on = Number.isNaN(bought.getTime())
    ? ""
    : ` on ${bought.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  let subject: string;
  let request: string[];
  switch (kind) {
    case "return":
    case "switch":
      subject = "Cancelling my order";
      request = [
        "I am cancelling this order under the Consumer Contracts Regulations 2013, within the 14-day cancellation period.",
        "Please refund the price and the standard delivery charge within 14 days. I will send the item back within 14 days of this email.",
        ...(returnPostagePence(order) === 0 ? ["Your returns are free, so please send me a prepaid returns label."] : []),
      ];
      break;
    case "fault_refund":
      subject = "Rejecting a faulty item";
      request = [
        "The item is faulty. Under the Consumer Rights Act 2015 I am rejecting it within 30 days and asking for a full refund.",
        "As it is faulty, please cover the cost of sending it back. A voucher or a partial refund is not an acceptable substitute.",
      ];
      break;
    case "replace":
      subject = "Faulty item: please replace it";
      request = [
        "The item is faulty. Under the Consumer Rights Act 2015 I am asking you to replace it within a reasonable time and at no cost to me.",
        "If the replacement fails or takes too long, I will ask for a refund.",
      ];
      break;
    case "repair":
      subject = "Faulty item: please repair it";
      request = [
        "The item is faulty. Under the Consumer Rights Act 2015 I am asking you to repair it within a reasonable time and at no cost to me.",
        "If the repair fails or takes too long, I will ask for a refund.",
      ];
      break;
    default: {
      const never: never = kind;
      return never;
    }
  }
  const name = buyerName?.trim();
  return {
    to: `${order.merchant} customer service`,
    subject: `${subject}: ${order.title}`,
    body: [
      `Hello ${order.merchant},`,
      `I bought "${order.title}" for ${formatPence(order.price_pence)}${on}.`,
      ...request,
      "Please confirm by reply.",
      name ? `Thanks,\n${name}` : "Thanks",
    ].join("\n\n"),
  };
}
