/**
 * Judge — owned by the Decision+UI agent. Amazon Bedrock via the Converse API.
 *
 * One `ConverseCommand` per shortlist (≤ 12 items), fixture photos attached as
 * image content blocks read from `public/`. Output is JSON validated against
 * `DecisionSchema`; on a validation failure we retry once with the error appended,
 * then fall back to the mock for any item still missing. The pound comparison stays in code.
 *
 * Model: `BEDROCK_MODEL_ID` (default `eu.anthropic.claude-sonnet-4-6`, a cross-region
 * EU inference profile). Region: `AWS_REGION ?? "eu-west-2"`. Default credential chain.
 *
 * Mock mode: `COVERED_MOCK=1`, or when Bedrock rejects the call with a credentials /
 * access error (logged and shown in the trace).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ImageFormat,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { DecisionSchema } from "@/lib/types";
import type { Decision, UserSettings } from "@/lib/types";
import type { JudgeMode, ShortlistItem } from "@/lib/decision";
import { buildUserContent, SYSTEM_PROMPT } from "./prompt";
import { mockDecision, mockJudge } from "./mock";

export type { Decision, Verdict, Listing, Offer } from "@/lib/types";

export const BEDROCK_REGION = process.env.AWS_REGION ?? "eu-west-2";
export const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "eu.anthropic.claude-sonnet-4-6";

const JudgeResponseSchema = z.object({
  summary: z.string(),
  decisions: z.array(DecisionSchema.extend({ id: z.string() })),
});
type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

export type JudgeResult = {
  decisions: Record<string, Decision>;
  summary: string;
  mode: JudgeMode;
  /** Short model label for the UI pill, e.g. "claude-sonnet-4-6". */
  model: string;
  /** Human-readable notes for the trace: which mode ran and why, retries, fallbacks. */
  notes: string[];
};

/** "eu.anthropic.claude-sonnet-4-6" → "claude-sonnet-4-6"; "amazon.nova-pro-v1:0" → "nova-pro-v1:0". */
export function shortModelName(modelId: string): string {
  const parts = modelId.split(".");
  return parts[parts.length - 1] ?? modelId;
}

export function judgeMode(): { mode: JudgeMode; why: string } {
  if (process.env.COVERED_MOCK === "1") return { mode: "mock", why: "COVERED_MOCK=1" };
  return { mode: "bedrock", why: `${BEDROCK_MODEL_ID} in ${BEDROCK_REGION}` };
}

const FORMAT_BY_EXT: Record<string, ImageFormat> = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
  ".gif": "gif",
};

export type LoadedImage = { format: ImageFormat; bytes: Uint8Array };

/** `/fixtures/x.jpg` → bytes from `public/`. Remote URLs are not fetched; grid thumbnails are not trusted photos. */
export async function loadImage(url: string): Promise<LoadedImage | null> {
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

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

/** Errors that mean "no point retrying, use the mock": credentials, access, missing model. */
function isAccessError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return (
    name === "AccessDeniedException" ||
    name === "UnrecognizedClientException" ||
    name === "ExpiredTokenException" ||
    name === "CredentialsProviderError" ||
    name === "ResourceNotFoundException" ||
    /credential|access denied|not authorized|security token/i.test(err instanceof Error ? err.message : "")
  );
}

async function callBedrock(client: BedrockRuntimeClient, messages: Message[]): Promise<string> {
  const out = await client.send(
    new ConverseCommand({
      modelId: BEDROCK_MODEL_ID,
      system: [{ text: SYSTEM_PROMPT }],
      messages,
      inferenceConfig: { maxTokens: 1500, temperature: 0.2 },
    }),
  );
  const text = out.output?.message?.content?.find((b): b is ContentBlock.TextMember => "text" in b)?.text;
  if (typeof text !== "string" || text.length === 0) throw new Error("empty completion");
  return text;
}

function parseResponse(text: string): JudgeResponse {
  const json: unknown = JSON.parse(stripFences(text));
  return JudgeResponseSchema.parse(json);
}

function mockResult(items: ShortlistItem[], settings: UserSettings, notes: string[]): JudgeResult {
  const { decisions, summary } = mockJudge(items, settings);
  return { decisions, summary, mode: "mock", model: "mock", notes };
}

/** Judge a shortlist. Never throws: any failure degrades to the mock with a note. */
export async function judge(query: string, settings: UserSettings, items: ShortlistItem[]): Promise<JudgeResult> {
  const { mode, why } = judgeMode();
  if (mode === "mock") {
    console.log(`[covered/judge] mode=mock (${why}) items=${items.length}`);
    return mockResult(items, settings, [`mock: ${why}`]);
  }

  console.log(`[covered/judge] mode=bedrock (${why}) items=${items.length}`);
  const notes: string[] = [`bedrock: ${why}`];
  const client = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  const content = await buildUserContent(query, settings, items, loadImage);
  const images = content.filter((b) => "image" in b).length;
  notes.push(`sent ${items.length} items, ${images} photos`);

  const messages: Message[] = [{ role: "user", content }];
  const started = Date.now();

  let parsed: JudgeResponse | null = null;
  for (let attempt = 1; attempt <= 2 && parsed === null; attempt += 1) {
    let raw = "";
    try {
      raw = await callBedrock(client, messages);
      parsed = parseResponse(raw);
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.warn(`[covered/judge] attempt ${attempt} failed: ${message}`);
      notes.push(`attempt ${attempt} failed: ${message.slice(0, 160)}`);
      if (isAccessError(err)) {
        console.warn("[covered/judge] credentials/access error, falling back to mock");
        notes.push("mock: Bedrock credentials or model access missing");
        return mockResult(items, settings, notes);
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
    summary = mockJudge(items, settings).summary;
    notes.push("bedrock unusable; mock for every item");
  }

  let filled = 0;
  for (const item of items) {
    if (!decisions[item.id]) {
      decisions[item.id] = mockDecision(item, items, settings);
      filled += 1;
    }
  }
  if (filled > 0 && parsed) notes.push(`${filled} item${filled === 1 ? "" : "s"} missing from the model, mock filled`);

  const resultMode: JudgeMode = parsed ? "bedrock" : "mock";
  console.log(`[covered/judge] done mode=${resultMode} mockFilled=${filled} in ${Date.now() - started} ms`);
  return {
    decisions,
    summary,
    mode: resultMode,
    model: parsed ? shortModelName(BEDROCK_MODEL_ID) : "mock",
    notes,
  };
}
