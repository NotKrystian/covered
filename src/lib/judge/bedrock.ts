/**
 * One Bedrock Runtime client and one per-process probe, shared by the judge and
 * the memory summariser. Owned by Judge+Memory.
 *
 * Model: `BEDROCK_MODEL_ID` (default `eu.anthropic.claude-haiku-4-5-20251001-v1:0`, an
 * EU cross-region inference profile: vision-capable, $1.00 in / $5.00 out per 1M tokens).
 * Region: `BEDROCK_REGION ?? AWS_REGION ?? "eu-west-2"`. Default credential chain.
 *
 * Mode: `mock` when `COVERED_MOCK=1` or when the probe `ConverseCommand` fails with a
 * credentials / access error. The probe runs once per process and is cached.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import type { JudgeMode } from "@/lib/decision";

export const BEDROCK_REGION = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? "eu-west-2";
export const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

/** "eu.anthropic.claude-haiku-4-5-20251001-v1:0" → "claude-haiku-4-5-20251001-v1:0". */
export function shortModelName(modelId: string): string {
  const parts = modelId.split(".");
  return parts[parts.length - 1] ?? modelId;
}

let client: BedrockRuntimeClient | null = null;
export function bedrockClient(): BedrockRuntimeClient {
  if (client === null) client = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  return client;
}

/** Errors that mean "no point retrying, use the mock": credentials, access, missing model. */
export function isAccessError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  return (
    name === "AccessDeniedException" ||
    name === "UnrecognizedClientException" ||
    name === "ExpiredTokenException" ||
    name === "CredentialsProviderError" ||
    name === "ResourceNotFoundException" ||
    name === "ValidationException" ||
    /credential|access denied|not authorized|security token|model identifier|enable/i.test(message)
  );
}

export function errorLabel(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

export type ConverseOptions = { system?: string; maxTokens?: number; temperature?: number };

export type ConverseResult = {
  text: string;
  /** "end_turn", "max_tokens", … as reported by the API; "unknown" when missing. */
  stopReason: string;
};

/** Send one Converse call and return the first text block plus the stop reason. Throws on an empty answer. */
export async function converse(messages: Message[], options: ConverseOptions = {}): Promise<ConverseResult> {
  const input: ConverseCommandInput = {
    modelId: BEDROCK_MODEL_ID,
    messages,
    inferenceConfig: { maxTokens: options.maxTokens ?? 1500, temperature: options.temperature ?? 0.2 },
  };
  if (options.system) input.system = [{ text: options.system }];
  const out = await bedrockClient().send(new ConverseCommand(input));
  const text = out.output?.message?.content?.find((b): b is ContentBlock.TextMember => "text" in b)?.text;
  if (typeof text !== "string" || text.length === 0) throw new Error("empty completion");
  return { text, stopReason: out.stopReason ?? "unknown" };
}

/** Send one Converse call and return the first text block. Throws on an empty answer. */
export async function converseText(messages: Message[], options: ConverseOptions = {}): Promise<string> {
  return (await converse(messages, options)).text;
}

export type ModeProbe = { mode: JudgeMode; why: string };

let probe: Promise<ModeProbe> | null = null;

/**
 * Decide the judge mode once per process. `COVERED_MOCK=1` short-circuits; otherwise a
 * tiny Converse call must succeed. A failure is cached too, so a denied model does not
 * cost a round trip on every request (restart the server after enabling access).
 */
export function judgeMode(): Promise<ModeProbe> {
  if (process.env.COVERED_MOCK === "1") {
    return Promise.resolve({ mode: "mock", why: "COVERED_MOCK=1" });
  }
  if (probe === null) {
    probe = (async (): Promise<ModeProbe> => {
      const started = Date.now();
      try {
        await converseText([{ role: "user", content: [{ text: "Reply with the single word OK." }] }], {
          maxTokens: 5,
          temperature: 0,
        });
        const why = `${BEDROCK_MODEL_ID} in ${BEDROCK_REGION} (probe ${Date.now() - started} ms)`;
        console.log(`[covered/bedrock] probe ok: ${why}`);
        return { mode: "bedrock", why };
      } catch (err) {
        const why = `Bedrock unreachable: ${errorLabel(err).slice(0, 160)}`;
        console.warn(`[covered/bedrock] probe failed, mock mode: ${why}`);
        return { mode: "mock", why };
      }
    })();
  }
  return probe;
}
