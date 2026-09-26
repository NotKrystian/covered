/**
 * Grok decision — owned by the Decision+UI agent.
 *
 * xAI is OpenAI-compatible: `new OpenAI({ baseURL: "https://api.x.ai/v1", apiKey: process.env.XAI_API_KEY })`.
 * One chat-completions call per shortlist (≤ 12 items), fixture photos attached as
 * data-URL image parts. Output is JSON validated against `DecisionSchema`; on a
 * validation failure we retry once with the error appended, then fall back to the
 * mock for any item still missing. The pound comparison stays in code.
 *
 * Mock mode: `XAI_API_KEY` absent or `COVERED_MOCK=1`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import { DecisionSchema } from "@/lib/types";
import type { Decision, UserSettings } from "@/lib/types";
import type { JudgeMode, ShortlistItem } from "@/lib/decision";
import { buildUserContent, SYSTEM_PROMPT } from "./prompt";
import { mockDecision, mockJudge } from "./mock";

export type { Decision, Verdict, Listing, Offer } from "@/lib/types";

export const XAI_BASE_URL = "https://api.x.ai/v1";
export const XAI_MODEL = process.env.XAI_MODEL ?? "grok-4.6";

const GrokResponseSchema = z.object({
  summary: z.string(),
  decisions: z.array(DecisionSchema.extend({ id: z.string() })),
});

export type JudgeResult = {
  decisions: Record<string, Decision>;
  summary: string;
  mode: JudgeMode;
  /** Human-readable notes for the trace: which mode ran and why, retries, fallbacks. */
  notes: string[];
};

export function judgeMode(): { mode: JudgeMode; why: string } {
  if (process.env.COVERED_MOCK === "1") return { mode: "mock", why: "COVERED_MOCK=1" };
  if (!process.env.XAI_API_KEY) return { mode: "mock", why: "XAI_API_KEY not set" };
  return { mode: "grok", why: `XAI_API_KEY set, model ${XAI_MODEL}` };
}

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** `/fixtures/x.jpg` → data URL read from `public/`; absolute http(s) URLs pass through. */
export async function resolveImageUrl(url: string): Promise<string | null> {
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  if (!url.startsWith("/")) return null;
  const safe = path.normalize(url).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(process.cwd(), "public", safe);
  try {
    const bytes = await readFile(file);
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

async function callGrok(
  client: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: XAI_MODEL,
    messages,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });
  const text = completion.choices[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) throw new Error("empty completion");
  return text;
}

function parseGrok(text: string): z.infer<typeof GrokResponseSchema> {
  const json: unknown = JSON.parse(stripFences(text));
  return GrokResponseSchema.parse(json);
}

/** Judge a shortlist. Never throws: any failure degrades to the mock with a note. */
export async function judge(
  query: string,
  settings: UserSettings,
  items: ShortlistItem[],
): Promise<JudgeResult> {
  const { mode, why } = judgeMode();
  if (mode === "mock") {
    console.log(`[covered/grok] mode=mock (${why}) items=${items.length}`);
    const { decisions, summary } = mockJudge(items, settings);
    return { decisions, summary, mode: "mock", notes: [`mock: ${why}`] };
  }

  console.log(`[covered/grok] mode=grok (${why}) items=${items.length}`);
  const notes: string[] = [`grok: ${why}`];
  const client = new OpenAI({ baseURL: XAI_BASE_URL, apiKey: process.env.XAI_API_KEY });
  const content = await buildUserContent(query, settings, items, resolveImageUrl);
  const images = content.filter((p) => p.type === "image_url").length;
  notes.push(`sent ${items.length} items, ${images} photos`);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content },
  ];

  let parsed: z.infer<typeof GrokResponseSchema> | null = null;
  for (let attempt = 1; attempt <= 2 && parsed === null; attempt += 1) {
    let raw = "";
    try {
      raw = await callGrok(client, messages);
      parsed = parseGrok(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[covered/grok] attempt ${attempt} failed: ${message}`);
      notes.push(`attempt ${attempt} failed: ${message.slice(0, 140)}`);
      // With a bad body, retry with the error appended. Without one (network, empty), retry as-is.
      if (attempt === 1 && raw) {
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: `That JSON failed validation: ${message}\nReturn the corrected JSON object only, one decision per listing id.`,
        });
      }
    }
  }

  const decisions: Record<string, Decision> = {};
  let summary: string;
  if (parsed) {
    for (const d of parsed.decisions) {
      const { id, ...decision } = d;
      if (items.some((i) => i.id === id)) decisions[id] = decision;
    }
    summary = parsed.summary;
  } else {
    summary = mockJudge(items, settings).summary;
    notes.push("grok unusable; mock for every item");
  }

  let filled = 0;
  for (const item of items) {
    if (!decisions[item.id]) {
      decisions[item.id] = mockDecision(item, items, settings);
      filled += 1;
    }
  }
  if (filled > 0 && parsed) notes.push(`${filled} item${filled === 1 ? "" : "s"} missing from Grok, mock filled`);

  const resultMode: JudgeMode = parsed ? "grok" : "mock";
  console.log(`[covered/grok] done mode=${resultMode} mockFilled=${filled}`);
  return { decisions, summary, mode: resultMode, notes };
}
