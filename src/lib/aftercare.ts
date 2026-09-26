/**
 * Returns and faults assistant for approved orders.
 *
 * Bedrock (same client as the judge) drafts what to send the seller and names
 * the UK right. Mock when COVERED_MOCK=1 or Bedrock fails. Never emails anyone.
 */
import type { Message } from "@aws-sdk/client-bedrock-runtime";
import type { UserSettings } from "@/lib/types";
import { formatPence } from "@/lib/money";
import { converseText, errorLabel, judgeMode, withThrottleBackoff } from "@/lib/judge/bedrock";
import type { OrderRecord } from "@/lib/memory";
import {
  AftercareAssistSchema,
  describeHistory,
  describeOrder,
  describeSettings,
  mockAftercareAssist,
  type AftercareAssist,
  type AftercareHistoryTurn,
} from "@/lib/aftercare-schema";

export {
  AftercareAssistRequestSchema,
  AftercareAssistSchema,
  AftercareHistoryTurnSchema,
  aftercareNote,
  aftercareOutcomeLine,
  emptyOrdersAssist,
  mockAftercareAssist,
  toAftercareEntry,
  type AftercareAssist,
  type AftercareAssistRequest,
  type AftercareHistoryTurn,
} from "@/lib/aftercare-schema";

export const AFTERCARE_SYSTEM = `You are Covered's aftercare assistant. You draft what the buyer should copy to the seller and say which UK right applies. You never email the merchant and you never claim a message was sent.

Return JSON only, no prose, no fences:
{"reply":"...","remedy":"refund"|"replace"|"repair"|"none","right":"...","draft_to_seller":string|null,"refused":boolean}

UK law (keep this):
- UK business, online, change of mind: 14 days from the day after delivery to cancel, then 14 days to send it back. Refund of the price and standard delivery. Return postage is on the buyer if the seller said so. No restocking fee.
- Faulty, Consumer Rights Act 2015: within 30 days of delivery, reject for a refund. A voucher or "15% off next time" is not that remedy. After 30 days, repair or replacement first, then a refund if that fails or is too slow. The shop's own warranty does not replace the statute.
- Used/refurbished from a business reseller still has these rights; quality is judged against age and description.
- Private seller: no cooling-off and no CRA quality right. You can challenge a false description only. Do not draft a statutory letter.
- If the user asks to say a change-of-mind is a fault ("I wore it and don't want it, tell them it arrived broken"), refuse. Do not invent a defect. If they describe a real fault, take it.
- If delivery date is unknown, use the order created_at as the purchase time and say you are counting from the order date, not a confirmed delivery.

Behaviour:
- reply is for the buyer: which right, what to do, that they must send the draft themselves.
- draft_to_seller is a ready-to-copy letter when a genuine remedy applies; null when refused, private-sale with no statutory path, or no order.
- refused is true only when they asked you to invent a fault or lie. Then remedy is "none" and draft_to_seller is null.
- remedy is the statutory path you are advising, or "none".
- Do not invent prices, dates, or defects that are not in the order or the buyer's words.`;

function extractJson(text: string): string {
  let body = text.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1) return body;
  return body.slice(start, end === -1 ? undefined : end + 1);
}

export type AftercareRun = {
  result: AftercareAssist;
  mode: "bedrock" | "mock";
  /** The probe line for bedrock; for mock, why it fell back. */
  why: string;
};

export async function runAftercareAssist(input: {
  order: OrderRecord;
  settings: UserSettings;
  message: string;
  history: AftercareHistoryTurn[];
  orders: OrderRecord[];
}): Promise<AftercareRun> {
  const { mode, why } = await judgeMode();
  if (mode === "mock") {
    return { result: mockAftercareAssist(input.order, input.message), mode: "mock", why };
  }

  const list =
    input.orders.length > 1
      ? input.orders
          .map((o) => `- ${o.id} · ${o.merchant} · ${o.title} · ${formatPence(o.price_pence)} · ${o.t.slice(0, 10)}`)
          .join("\n")
      : "(this is the only order)";

  const messages: Message[] = [
    {
      role: "user",
      content: [
        {
          text: [
            `Selected order:\n${describeOrder(input.order)}`,
            `Buyer protection settings: ${describeSettings(input.settings.protection_premium_pence, input.settings.switch_minimum_pence, input.settings.approval)}`,
            `All approved orders:\n${list}`,
            `Chat so far:\n${describeHistory(input.history)}`,
            `Buyer now: ${input.message}`,
            "Return the JSON object now.",
          ].join("\n\n"),
        },
      ],
    },
  ];

  let lastError = "no attempt";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw = "";
    try {
      raw = await withThrottleBackoff(
        () => converseText(messages, { system: AFTERCARE_SYSTEM, maxTokens: 900, temperature: 0.2 }),
        {
          onThrottle: (retry, waitMs) =>
            console.warn(`[covered/aftercare] attempt ${attempt} throttled, backoff ${retry} for ${waitMs} ms`),
        },
      );
      const parsed = AftercareAssistSchema.parse(JSON.parse(extractJson(raw)));
      return { result: parsed, mode: "bedrock", why };
    } catch (err) {
      const label = errorLabel(err);
      lastError = label.slice(0, 160);
      console.warn(`[covered/aftercare] attempt ${attempt} failed: ${label}`);
      if (attempt === 1 && raw) {
        messages.push({ role: "assistant", content: [{ text: raw }] });
        messages.push({
          role: "user",
          content: [
            {
              text: `That JSON failed validation: ${label}\nReturn {"reply","remedy","right","draft_to_seller","refused"} only.`,
            },
          ],
        });
      }
    }
  }
  const fallback = `bedrock answer unusable after 2 attempts (${lastError})`;
  console.warn(`[covered/aftercare] ${fallback}; mock`);
  return { result: mockAftercareAssist(input.order, input.message), mode: "mock", why: fallback };
}
