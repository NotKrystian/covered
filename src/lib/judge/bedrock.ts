/**
 * One Bedrock Runtime client and one per-process probe, shared by the judge and
 * the memory summariser. Owned by Judge+Memory.
 *
 * Model: `BEDROCK_MODEL_ID` (default `eu.anthropic.claude-haiku-4-5-20251001-v1:0`, an
 * EU cross-region inference profile: vision-capable, $1.00 in / $5.00 out per 1M tokens).
 * Region: `BEDROCK_REGION ?? AWS_REGION ?? "eu-west-2"`. Default credential chain.
 *
 * Mode: `mock` when `COVERED_MOCK=1` or when the probe `ConverseCommand` fails. A good
 * probe is cached for the process; a failed one only for `PROBE_RETRY_MS` (throttle,
 * timeout, 5xx) or `PROBE_LASTING_RETRY_MS` (access, model id, credentials).
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import type { JudgeMode } from "@/lib/decision";

// `||`, not `??`: .env.example ships these keys empty, and an empty string must fall back too.
export const BEDROCK_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || "eu-west-2";
export const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || "eu.anthropic.claude-haiku-4-5-20251001-v1:0";

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

/** Bedrock asked us to slow down. Worth waiting for; never a reason to fall back to the mock early. */
export function isThrottleError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return err.name === "ThrottlingException" || err.name === "TooManyRequestsException" || status === 429;
}

/**
 * Base waits before each throttle retry; each gets ±25% jitter so parallel batches do not retry in step.
 * Sized for per-minute quotas: at 10 requests/min a slot frees every 6 s, so the waits must reach that far.
 */
export const THROTTLE_BACKOFF_MS: readonly number[] = [1000, 3000, 7000];

export type ThrottleBackoffOptions = {
  onThrottle?: (retry: number, waitMs: number, err: unknown) => void;
  delaysMs?: readonly number[];
};

/** Run `call`, retrying only throttles, once per entry in `delaysMs`. Any other error, or a throttle after the last wait, is rethrown. */
export async function withThrottleBackoff<T>(
  call: () => Promise<T>,
  { onThrottle, delaysMs = THROTTLE_BACKOFF_MS }: ThrottleBackoffOptions = {},
): Promise<T> {
  for (let retry = 0; ; retry += 1) {
    try {
      return await call();
    } catch (err) {
      const base = delaysMs[retry];
      if (base === undefined || !isThrottleError(err)) throw err;
      const waitMs = Math.round(base * (0.75 + Math.random() * 0.5));
      onThrottle?.(retry + 1, waitMs, err);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
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

/** A throttled, timed-out or 5xx probe: mock only this long, then probe again. */
export const PROBE_RETRY_MS = 60_000;
/** Access denied, bad model id, no credentials: mock this long, then probe again (access can be granted without a restart). */
export const PROBE_LASTING_RETRY_MS = 5 * 60_000;
export const PROBE_TIMEOUT_MS = 10_000;

/** Why a probe failed: `lasting` needs someone to fix access; `transient` clears on its own. */
export type ProbeFailure = "lasting" | "transient";

export function probeFailureKind(err: unknown): ProbeFailure {
  if (isThrottleError(err)) return "transient";
  return isAccessError(err) ? "lasting" : "transient";
}

type ProbeState =
  | { kind: "pending"; result: Promise<ModeProbe> }
  | { kind: "settled"; mode: JudgeMode; reason: string; retryAt: number };

let probeState: ProbeState | null = null;

function settledProbe(state: Extract<ProbeState, { kind: "settled" }>, now: number): ModeProbe {
  if (state.mode === "bedrock") return { mode: "bedrock", why: state.reason };
  return { mode: "mock", why: `${state.reason}; probing again in ${Math.max(1, Math.ceil((state.retryAt - now) / 1000))} s` };
}

async function probeWithTimeout(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`no answer in ${PROBE_TIMEOUT_MS} ms`), { name: "TimeoutError" })),
      PROBE_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([
      converseText([{ role: "user", content: [{ text: "Reply with the single word OK." }] }], { maxTokens: 5, temperature: 0 }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runProbe(): Promise<Extract<ProbeState, { kind: "settled" }>> {
  const started = Date.now();
  try {
    await probeWithTimeout();
    const reason = `${BEDROCK_MODEL_ID} in ${BEDROCK_REGION} (probe ${Date.now() - started} ms)`;
    console.log(`[covered/bedrock] probe ok: ${reason}`);
    return { kind: "settled", mode: "bedrock", reason, retryAt: Number.POSITIVE_INFINITY };
  } catch (err) {
    const label = errorLabel(err).slice(0, 160);
    const failure = probeFailureKind(err);
    let reason: string;
    let waitMs: number;
    switch (failure) {
      case "lasting":
        reason = `Bedrock access missing (${label})`;
        waitMs = PROBE_LASTING_RETRY_MS;
        break;
      case "transient":
        reason = isThrottleError(err) ? `Bedrock throttled the probe (${label})` : `Bedrock probe failed (${label})`;
        waitMs = PROBE_RETRY_MS;
        break;
      default: {
        const unhandled: never = failure;
        throw new Error(`unhandled probe failure ${String(unhandled)}`);
      }
    }
    console.warn(`[covered/bedrock] probe failed (${failure}), mock for ${waitMs / 1000} s: ${reason}`);
    return { kind: "settled", mode: "mock", reason, retryAt: Date.now() + waitMs };
  }
}

/**
 * The judge mode, shared by every Bedrock caller. `COVERED_MOCK=1` short-circuits;
 * otherwise a tiny Converse call must succeed. Concurrent callers share one probe.
 * Success is kept for the process; a mock result expires and the next call probes again.
 */
export function judgeMode(): Promise<ModeProbe> {
  if (process.env.COVERED_MOCK === "1") {
    return Promise.resolve({ mode: "mock", why: "COVERED_MOCK=1" });
  }
  if (probeState?.kind === "pending") return probeState.result;
  const now = Date.now();
  if (probeState?.kind === "settled" && now < probeState.retryAt) return Promise.resolve(settledProbe(probeState, now));

  const result = runProbe().then((settled) => {
    probeState = settled;
    return settledProbe(settled, Date.now());
  });
  probeState = { kind: "pending", result };
  return result;
}

/** Forget the cached probe so the next `judgeMode()` probes again. For tests. */
export function resetJudgeMode(): void {
  probeState = null;
}
