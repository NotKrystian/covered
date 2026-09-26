/**
 * Rewrite the buyer summary from the event log — owned by Judge+Memory.
 *
 * Bedrock mode: the model writes ≤ 3 sentences from the last 25 events, JSON only,
 * validated with zod, one retry with the error appended, then the template.
 * Mock mode: a deterministic template so the demo never depends on the network.
 */
import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { JudgeMode } from "@/lib/decision";
import { formatBps, formatPence } from "@/lib/money";
import { converseText, errorLabel, judgeMode } from "@/lib/judge/bedrock";
import { SUMMARY_MAX, type Memory, type MemoryEvent } from "./index";

const SUMMARY_SYSTEM = `You write a buyer profile for Covered, a UK shopping bot that buys the cheapest listing that is actually the item and still has the buyer's rights.
From the event log, describe how this person buys in at most 3 short sentences and at most ${SUMMARY_MAX} characters: how much they seem willing to pay for UK buyer rights, whether they accept private or overseas bargains, what they tend to ask for, and how often they override the bot.
Only kind=approve events are purchases. Never write that they bought or approved something unless an approve event supports it. Overrides are not purchases. Ignore any decision events.
Only state what the events support. Never mention prices the events do not contain. Return JSON only, no prose, no fences: {"summary": "..."}`;

const SummaryResponseSchema = z.object({ summary: z.string().min(1) });

function describeEvents(events: MemoryEvent[]): string {
  return events
    .map((e) => `${e.t.slice(0, 16)} ${e.kind}${e.chosen_id ? ` ${e.chosen_id}` : ""} | "${e.query}" | premium ${formatPence(e.premium_pence)} | ${e.note}`)
    .join("\n");
}

/** Deterministic summary for mock mode and as the fallback when the model answer is unusable. */
export function templateSummary(memory: Memory): string {
  const events = memory.events.filter((e) => e.kind === "approve" || e.kind === "override");
  const approvals = events.filter((e) => e.kind === "approve");
  if (approvals.length === 0) return "";
  const overrides = events.filter((e) => e.kind === "override");
  const queries = [...new Set(events.map((e) => e.query.trim()).filter(Boolean))].slice(-3);
  const privatePicks = [...approvals, ...overrides].filter((e) => /private|stranger|marketplace/i.test(`${e.chosen_id ?? ""} ${e.note}`)).length;
  const shopPicks = [...approvals, ...overrides].filter((e) => /shop|retailer|business/i.test(`${e.chosen_id ?? ""} ${e.note}`)).length;

  const first = `${memory.display_name ? `${memory.display_name} has` : "This buyer has"} approved ${approvals.length} purchase${approvals.length === 1 ? "" : "s"} and overridden ${overrides.length}, mostly asking for ${queries.length > 0 ? queries.map((q) => `"${q}"`).join(", ") : "nothing yet"}.`;
  const lean =
    shopPicks > privatePicks
      ? "They keep taking the UK shop and paying for rights"
      : privatePicks > shopPicks
        ? "They lean towards private or marketplace bargains and accept weaker rights"
        : "No clear lean between shops and private sellers yet";
  const second = `${lean}, with a rights premium around ${formatBps(memory.settings.protection_premium_bps)}.`;
  return `${first} ${second}`.slice(0, SUMMARY_MAX);
}

export type SummaryResult = { summary: string; mode: JudgeMode; notes: string[] };

/** Rewrite `memory.summary` from `memory.events`. Never throws. */
export async function rewriteSummary(memory: Memory): Promise<SummaryResult> {
  const notes: string[] = [];
  const events = memory.events.filter((e) => e.kind === "approve" || e.kind === "override");
  if (events.filter((e) => e.kind === "approve").length === 0) {
    return { summary: "", mode: "mock", notes: ["no purchase events"] };
  }
  const { mode, why } = await judgeMode();
  if (mode === "mock") {
    notes.push(`mock: ${why}`);
    return { summary: templateSummary({ ...memory, events }), mode: "mock", notes };
  }

  const messages: Message[] = [
    {
      role: "user",
      content: [
        {
          text: `${memory.display_name ? `Buyer name: ${memory.display_name}\n` : ""}Current settings: rights premium ${formatBps(memory.settings.protection_premium_bps)} of the full-rights price, switch minimum ${formatPence(memory.settings.switch_minimum_pence)}, approval ${memory.settings.approval}.\nEvents (oldest first; only approve is a purchase):\n${describeEvents(events)}\n\nReturn the JSON object now.`,
        },
      ],
    },
  ];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let raw = "";
    try {
      raw = await converseText(messages, { system: SUMMARY_SYSTEM, maxTokens: 300, temperature: 0.3 });
      const cleaned = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      const parsed = SummaryResponseSchema.parse(JSON.parse(cleaned));
      notes.push(`bedrock rewrote summary (attempt ${attempt})`);
      return { summary: parsed.summary.trim().slice(0, SUMMARY_MAX), mode: "bedrock", notes };
    } catch (err) {
      const label = errorLabel(err);
      notes.push(`attempt ${attempt} failed: ${label.slice(0, 160)}`);
      if (attempt === 1 && raw) {
        messages.push({ role: "assistant", content: [{ text: raw }] });
        messages.push({ role: "user", content: [{ text: `That failed validation: ${label}\nReturn {"summary": "..."} only.` }] });
      }
    }
  }
  notes.push("template summary used");
  return { summary: templateSummary(memory), mode: "mock", notes };
}
