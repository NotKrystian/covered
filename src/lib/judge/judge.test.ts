import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { ContentBlock, ConverseCommand, Message } from "@aws-sdk/client-bedrock-runtime";
import { offerToItem, type ShortlistItem } from "../decision";
import { UserSettingsSchema, type Offer } from "../types";
import { bedrockClient, isThrottleError, withThrottleBackoff } from "./bedrock";
import { judge, type JudgeResult } from "./index";
import { mapPool } from "./pool";

delete process.env.COVERED_MOCK;

type Call = { batch: number; ids: string[]; images: number; turns: number; lastText: string };
type Reply = { text: string } | { error: Error };

const settings = UserSettingsSchema.parse({});
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 84 listings → 14 batches of 6. Two listings in batch 2 carry a fixture photo. */
const items: ShortlistItem[] = Array.from({ length: 84 }, (_, i) => {
  const offer: Offer = {
    section: "browse",
    title: `Black fleece jacket ${i + 1}`,
    price: `£${30 + i}.00`,
    compare_at: null,
    merchant: `Shop ${i + 1}`,
    badge: null,
    delivery: null,
    rating: null,
    rating_count: null,
  };
  const item = offerToItem(offer, i);
  return i === 6 || i === 7 ? { ...item, image_urls: ["/fixtures/fleece-black.jpg"] } : item;
});
const batchOf = new Map(items.map((item, i) => [item.id, Math.floor(i / 6) + 1]));
const idsOfBatch = (batch: number) => items.slice((batch - 1) * 6, batch * 6).map((i) => i.id);

function textOf(message: Message | undefined): string {
  return (message?.content ?? [])
    .filter((b): b is ContentBlock.TextMember => "text" in b)
    .map((b) => b.text)
    .join("\n");
}

function answer(ids: string[]): string {
  return JSON.stringify({
    summary: `fake summary for ${ids[0]}`,
    // Reversed on purpose: the merge must follow listing order, not the model's.
    decisions: [...ids].reverse().map((id) => ({
      id,
      same_item: true,
      mislisting: false,
      photo_reason: null,
      sponsored: false,
      seller_type: "uk_business",
      venue_trust: "shop_checkout",
      rights: ["14-day cancellation"],
      recommendation: "buy",
      reason: `fake reason for ${id}`,
    })),
  });
}

function throttle(): Error {
  return Object.assign(new Error("Too many requests, please wait before trying again."), {
    name: "ThrottlingException",
    $metadata: { httpStatusCode: 429 },
  });
}

let calls: Call[] = [];
let inFlight = 0;
let maxInFlight = 0;
let handler: (call: Call) => Promise<Reply> = async (call) => ({ text: answer(call.ids) });

mock.method(bedrockClient(), "send", async (command: ConverseCommand) => {
  const messages = command.input.messages ?? [];
  const first = textOf(messages[0]);
  if (first.includes("Reply with the single word OK.")) {
    return { output: { message: { role: "assistant", content: [{ text: "OK" }] } }, stopReason: "end_turn", $metadata: {} };
  }
  const ids = [...new Set([...first.matchAll(/— id: (\S+)/g)].map((m) => m[1] as string))];
  const call: Call = {
    batch: batchOf.get(ids[0] as string) ?? 0,
    ids,
    images: (messages[0]?.content ?? []).filter((b) => "image" in b).length,
    turns: messages.length,
    lastText: textOf(messages[messages.length - 1]),
  };
  calls.push(call);
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    const reply = await handler(call);
    if ("error" in reply) throw reply.error;
    return { output: { message: { role: "assistant", content: [{ text: reply.text }] } }, stopReason: "end_turn", $metadata: {} };
  } finally {
    inFlight -= 1;
  }
});

async function run(concurrency: number): Promise<{ result: JudgeResult; ms: number }> {
  process.env.JUDGE_CONCURRENCY = String(concurrency);
  const started = Date.now();
  const result = await judge("black fleece jacket medium", settings, items);
  return { result, ms: Date.now() - started };
}

beforeEach(() => {
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
});

afterEach(() => {
  delete process.env.JUDGE_CONCURRENCY;
  handler = async (call) => ({ text: answer(call.ids) });
});

test("14 batches at concurrency 4 take about 4 batch times and keep listing order", async () => {
  const BATCH_MS = 120;
  // Batch 1 is slowest, so batches finish out of order.
  handler = async (call) => {
    await sleep(call.batch === 1 ? BATCH_MS + 60 : BATCH_MS);
    return { text: answer(call.ids) };
  };
  const { result, ms } = await run(4);

  assert.equal(maxInFlight, 4);
  assert.ok(ms >= 4 * BATCH_MS - 15, `took ${ms} ms, expected at least ~${4 * BATCH_MS}`);
  assert.ok(ms < 7 * BATCH_MS, `took ${ms} ms; sequential would be ~${14 * BATCH_MS}`);

  assert.equal(result.mode, "bedrock");
  assert.deepEqual(Object.keys(result.decisions), items.map((i) => i.id));
  for (const item of items) assert.equal(result.decisions[item.id]?.reason, `fake reason for ${item.id}`);
  assert.equal(result.summary, `fake summary for ${items[0]?.id}`);

  assert.equal(calls.length, 14);
  for (const call of calls) {
    assert.deepEqual(call.ids, idsOfBatch(call.batch), `batch ${call.batch} was sent someone else's listings`);
    assert.equal(call.images, call.batch === 2 ? 2 : 0, `batch ${call.batch} photo count`);
  }

  const headlines = result.notes.filter((n) => /^batch \d+\/14: /.test(n));
  assert.deepEqual(
    headlines.map((n) => Number(n.match(/^batch (\d+)/)?.[1])),
    Array.from({ length: 14 }, (_, i) => i + 1),
  );
  for (const line of headlines) assert.match(line, /→ bedrock in \d+\.\d s$/);
  assert.match(result.notes[result.notes.length - 1] ?? "", /^14 batches in \d+\.\d s \(concurrency 4\)$/);
});

test("concurrency 1 runs one batch at a time with the same decisions", async () => {
  const BATCH_MS = 30;
  handler = async (call) => {
    await sleep(BATCH_MS);
    return { text: answer(call.ids) };
  };
  const parallel = await run(4);
  maxInFlight = 0;
  const serial = await run(1);

  assert.equal(maxInFlight, 1);
  assert.ok(serial.ms >= 14 * BATCH_MS - 15, `serial took ${serial.ms} ms`);
  assert.deepEqual(serial.result.decisions, parallel.result.decisions);
  assert.deepEqual(Object.keys(serial.result.decisions), Object.keys(parallel.result.decisions));
  assert.match(serial.result.notes[serial.result.notes.length - 1] ?? "", /\(concurrency 1\)$/);
});

test("a throttle backs off without spending the parse retry and halves the pool", async () => {
  let throttled = false;
  handler = async (call) => {
    if (call.batch === 2 && !throttled) {
      throttled = true;
      return { error: throttle() };
    }
    return { text: answer(call.ids) };
  };
  const { result } = await run(4);

  const batch2 = calls.filter((c) => c.batch === 2);
  assert.equal(batch2.length, 2);
  assert.ok(batch2.every((c) => c.turns === 1), "a throttle must not append a parse-error turn");
  for (const id of idsOfBatch(2)) assert.equal(result.decisions[id]?.reason, `fake reason for ${id}`);
  assert.ok(result.notes.some((n) => /^batch 2\/14 attempt 1: throttled, backoff 1\/3 for \d+ ms$/.test(n)));
  assert.ok(!result.notes.some((n) => n.startsWith("batch 2/14 attempt 1 failed")));
  assert.match(result.notes.find((n) => n.startsWith("batch 2/14: ")) ?? "", /→ bedrock in/);
  assert.match(result.notes[result.notes.length - 1] ?? "", /\(concurrency 4, down to 2 after Bedrock throttling\)$/);
});

test("a one-at-a-time quota drops the pool to 1 instead of mocking batches", async () => {
  // Any call that arrives while another is in flight is throttled, like a tiny requests-per-minute quota.
  handler = async (call) => {
    if (inFlight > 1) return { error: throttle() };
    await sleep(5);
    return { text: answer(call.ids) };
  };
  const { result } = await run(4);

  assert.equal(result.mode, "bedrock");
  for (const item of items) assert.equal(result.decisions[item.id]?.reason, `fake reason for ${item.id}`);
  assert.ok(!result.notes.some((n) => n.includes("mock")), "no batch may fall back to the mock");
  assert.match(result.notes[result.notes.length - 1] ?? "", /\(concurrency 4, down to 1 after Bedrock throttling\)$/);
});

test("bad JSON retries once with the error, then mocks only that batch", async () => {
  handler = async (call) => (call.batch === 3 ? { text: "not json" } : { text: answer(call.ids) });
  const { result } = await run(4);

  const batch3 = calls.filter((c) => c.batch === 3);
  assert.equal(batch3.length, 2);
  assert.equal(batch3[1]?.turns, 3);
  assert.match(batch3[1]?.lastText ?? "", /That JSON failed validation/);

  assert.equal(result.mode, "bedrock");
  for (const item of items) {
    const fromModel = result.decisions[item.id]?.reason === `fake reason for ${item.id}`;
    assert.equal(fromModel, batchOf.get(item.id) !== 3, `${item.id} came from the wrong judge`);
  }
  assert.ok(result.notes.includes("batch 3/14: bedrock unusable; mock for this batch"));
  assert.match(result.notes.find((n) => n.startsWith("batch 3/14: 6 items")) ?? "", /→ mock in/);
  assert.equal(result.notes.filter((n) => n.includes("mock for this batch")).length, 1);
});

test("withThrottleBackoff gives up after the last wait and never retries other errors", async () => {
  let attempts = 0;
  await assert.rejects(
    withThrottleBackoff(
      async () => {
        attempts += 1;
        throw throttle();
      },
      { delaysMs: [1, 1, 1] },
    ),
    /Too many requests/,
  );
  assert.equal(attempts, 4);

  attempts = 0;
  await assert.rejects(
    withThrottleBackoff(
      async () => {
        attempts += 1;
        throw new Error("boom");
      },
      { delaysMs: [1, 1, 1] },
    ),
    /boom/,
  );
  assert.equal(attempts, 1);
});

test("isThrottleError knows throttles and 429s, not access errors", () => {
  assert.equal(isThrottleError(throttle()), true);
  assert.equal(isThrottleError(Object.assign(new Error("slow down"), { name: "TooManyRequestsException" })), true);
  assert.equal(isThrottleError(Object.assign(new Error("x"), { name: "Unknown", $metadata: { httpStatusCode: 429 } })), true);
  assert.equal(isThrottleError(Object.assign(new Error("denied"), { name: "AccessDeniedException" })), false);
  assert.equal(isThrottleError("ThrottlingException"), false);
});

test("mapPool keeps input order and handles empty input", async () => {
  const out = await mapPool([30, 5, 20, 1], 2, async (ms, i) => {
    await sleep(ms);
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3]);
  assert.deepEqual(await mapPool([], 4, async () => 1), []);
});

test("mapPool stops starting tasks beyond a lowered limit", async () => {
  let limit = 4;
  let running = 0;
  const peaks: number[] = [];
  const out = await mapPool(
    Array.from({ length: 12 }, (_, i) => i),
    () => limit,
    async (n) => {
      running += 1;
      peaks.push(running);
      await sleep(10);
      if (n === 0) limit = 1;
      running -= 1;
      return n * 2;
    },
  );
  assert.deepEqual(out, Array.from({ length: 12 }, (_, i) => i * 2));
  assert.deepEqual(peaks.slice(0, 4), [1, 2, 3, 4]);
  assert.ok(peaks.slice(4).every((p) => p === 1), `after the drop: ${peaks.slice(4).join(",")}`);
});
