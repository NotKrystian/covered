/**
 * Judge — owned by Judge+Memory. Amazon Bedrock via the Converse API.
 *
 * One `ConverseCommand` per shortlist (≤ 12 items), fixture photos attached as
 * image content blocks read from `public/`. Output is JSON validated against
 * `DecisionSchema`; on a validation failure we retry once with the error appended,
 * then fall back to the mock for any item still missing. The pound comparison stays in code.
 *
 * Model, region and the per-process mode probe live in `./bedrock`. Mock mode:
 * `COVERED_MOCK=1`, or when the probe fails (credentials / model access), shown in the trace.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageFormat, Message } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { DecisionSchema } from "@/lib/types";
import type { Decision, UserSettings } from "@/lib/types";
import type { JudgeMode, ShortlistItem } from "@/lib/decision";
import { safeImageDataUrl, sniffImageFormat } from "@/lib/photo-safety";
import { buildUserContent, SYSTEM_PROMPT } from "./prompt";
import { mockDecision, mockJudge } from "./mock";
import { BEDROCK_MODEL_ID, converse, errorLabel, isAccessError, judgeMode, shortModelName } from "./bedrock";
import type { ProductBrief } from "./research";
export { researchProduct, researchTraceDetail } from "./research";
export type { ProductBrief, ResearchResult } from "./research";

export type { Decision, Verdict, Listing, Offer } from "@/lib/types";
export { BEDROCK_MODEL_ID, BEDROCK_REGION, judgeMode, shortModelName } from "./bedrock";

const JudgeResponseSchema = z.object({
  summary: z.string(),
  decisions: z.array(DecisionSchema.extend({ id: z.string() })),
});
type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

export type JudgeResult = {
  decisions: Record<string, Decision>;
  summary: string;
  mode: JudgeMode;
  /** Full model id when Bedrock answered, "mock" otherwise. */
  model: string;
  /** Human-readable notes for the trace: which mode ran and why, retries, fallbacks. */
  notes: string[];
};

/** Optional context from preference memory. Plain text, already capped by the memory module. */
export type JudgeContext = {
  /** "What we know about this buyer" block, or null when memory is empty. */
  memory: string | null;
  /** Researched identity of the query. Same_item is judged against this, not the raw string. */
  brief?: ProductBrief | null;
};

const FORMAT_BY_EXT: Record<string, ImageFormat> = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
  ".gif": "gif",
};

export type LoadedImage = { format: ImageFormat; bytes: Uint8Array };

/** A vetted raster data URL → bytes. The format comes from the magic bytes, not the label. */
function decodeDataUrl(url: string): LoadedImage | null {
  const safe = safeImageDataUrl(url);
  if (!safe) return null;
  const bytes = new Uint8Array(Buffer.from(safe.slice(safe.indexOf(",") + 1), "base64"));
  const format = sniffImageFormat(bytes);
  return format ? { format, bytes } : null;
}

/** Fixture paths from `public/`, or jpeg/png data URLs captured by the reader. Remote URLs are not fetched. */
export async function loadImage(url: string): Promise<LoadedImage | null> {
  if (url.startsWith("data:image/")) return decodeDataUrl(url);
  if (!url.startsWith("/")) return null;
  const safe = path.normalize(url).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(process.cwd(), "public", safe);
  const format = FORMAT_BY_EXT[path.extname(file).toLowerCase()];
  if (!format) return null;
  try {
    const bytes = await readFile(file);
    return { format, bytes: new Uint8Array(bytes) };
  } catch {
    return null;
  }
}

/**
 * Pull the JSON object out of a completion. Tolerates a leading ```json fence with or
 * without its closing fence (a truncated answer has none) and any prose around the object.
 */
function extractJson(text: string): string {
  let body = text.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1) return body;
  return body.slice(start, end === -1 ? undefined : end + 1);
}

function parseResponse(text: string): JudgeResponse {
  const json: unknown = JSON.parse(extractJson(text));
  return JudgeResponseSchema.parse(json);
}

/** Output budget: ~12 decisions × ~120 tokens plus a summary, with headroom so the JSON never truncates. */
const JUDGE_MAX_TOKENS = 4000;

function mockResult(
  items: ShortlistItem[],
  settings: UserSettings,
  notes: string[],
  brief: ProductBrief | null,
): JudgeResult {
  const { decisions, summary } = mockJudge(items, settings, brief);
  return { decisions, summary, mode: "mock", model: "mock", notes };
}

/** Judge a shortlist. Never throws: any failure degrades to the mock with a note. */
export async function judge(
  query: string,
  settings: UserSettings,
  items: ShortlistItem[],
  context: JudgeContext = { memory: null },
): Promise<JudgeResult> {
  const { mode, why } = await judgeMode();
  if (mode === "mock") {
    console.log(`[covered/judge] mode=mock (${why}) items=${items.length}`);
    return mockResult(items, settings, [`mock: ${why}`], context.brief ?? null);
  }

  console.log(`[covered/judge] mode=bedrock (${why}) items=${items.length}`);
  const notes: string[] = [`bedrock: ${why}`];
  const content = await buildUserContent(query, settings, items, loadImage, context.memory, context.brief ?? null);
  const images = content.filter((b) => "image" in b).length;
  notes.push(`sent ${items.length} items, ${images} photos${context.memory ? ", buyer memory" : ""}`);

  const messages: Message[] = [{ role: "user", content }];
  const started = Date.now();

  let parsed: JudgeResponse | null = null;
  for (let attempt = 1; attempt <= 2 && parsed === null; attempt += 1) {
    let raw = "";
    try {
      const out = await converse(messages, { system: SYSTEM_PROMPT, maxTokens: JUDGE_MAX_TOKENS, temperature: 0.2 });
      raw = out.text;
      if (out.stopReason === "max_tokens") {
        notes.push(`attempt ${attempt}: output hit the ${JUDGE_MAX_TOKENS} token cap`);
      }
      parsed = parseResponse(raw);
    } catch (err) {
      const message = errorLabel(err);
      console.warn(`[covered/judge] attempt ${attempt} failed: ${message}`);
      notes.push(`attempt ${attempt} failed: ${message.slice(0, 160)}`);
      if (isAccessError(err)) {
        console.warn("[covered/judge] credentials/access error, falling back to mock");
        notes.push("mock: Bedrock credentials or model access missing");
        return mockResult(items, settings, notes, context.brief ?? null);
      }
      // With a bad body, retry with the error appended. Without one (network, empty), retry as-is.
      if (attempt === 1 && raw) {
        messages.push({ role: "assistant", content: [{ text: raw }] });
        messages.push({
          role: "user",
          content: [
            {
              text: `That JSON failed validation: ${message}\nReturn the corrected JSON object only, one decision per listing id.`,
            },
          ],
        });
      }
    }
  }
  notes.push(`bedrock took ${Date.now() - started} ms`);

  const decisions: Record<string, Decision> = {};
  let summary: string;
  if (parsed) {
    for (const d of parsed.decisions) {
      const { id, ...decision } = d;
      if (items.some((i) => i.id === id)) decisions[id] = decision;
    }
    summary = parsed.summary;
  } else {
    summary = mockJudge(items, settings, context.brief ?? null).summary;
    notes.push("bedrock unusable; mock for every item");
  }

  let filled = 0;
  for (const item of items) {
    if (!decisions[item.id]) {
      decisions[item.id] = mockDecision(item, items, settings, context.brief ?? null);
      filled += 1;
    }
  }
  if (filled > 0 && parsed) notes.push(`${filled} item${filled === 1 ? "" : "s"} missing from the model, mock filled`);

  const resultMode: JudgeMode = parsed ? "bedrock" : "mock";
  console.log(
    `[covered/judge] done mode=${resultMode} model=${shortModelName(BEDROCK_MODEL_ID)} mockFilled=${filled} in ${Date.now() - started} ms`,
  );
  return {
    decisions,
    summary,
    mode: resultMode,
    model: parsed ? BEDROCK_MODEL_ID : "mock",
    notes,
  };
}
