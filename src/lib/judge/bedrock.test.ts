import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import {
  bedrockClient,
  judgeMode,
  PROBE_LASTING_RETRY_MS,
  PROBE_RETRY_MS,
  probeFailureKind,
  resetJudgeMode,
} from "./bedrock";

delete process.env.COVERED_MOCK;

type Reply = "ok" | Error;

const ok = { output: { message: { role: "assistant", content: [{ text: "OK" }] } }, stopReason: "end_turn", $metadata: {} };

function awsError(name: string, message: string, status: number): Error {
  return Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } });
}
const throttle = () => awsError("ThrottlingException", "Too many requests, please wait before trying again.", 429);
const denied = () => awsError("AccessDeniedException", "You don't have access to the model with the specified model ID.", 403);
const badModel = () => awsError("ValidationException", "The provided model identifier is invalid.", 400);
const serverError = () => awsError("InternalServerException", "Internal server error", 500);
const noCredentials = () => Object.assign(new Error("Could not load credentials from any providers"), { name: "CredentialsProviderError" });

let replies: Reply[] = [];
let probes = 0;

mock.method(bedrockClient(), "send", async () => {
  probes += 1;
  const reply = replies.shift() ?? "ok";
  if (reply instanceof Error) throw reply;
  return ok;
});

beforeEach(() => {
  resetJudgeMode();
  replies = [];
  probes = 0;
  delete process.env.COVERED_MOCK;
  mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
});

afterEach(() => {
  mock.timers.reset();
});

test("a throttled probe mocks for 60 s without saying unreachable, then Bedrock", async () => {
  replies = [throttle()];

  const first = await judgeMode();
  assert.equal(first.mode, "mock");
  assert.match(first.why, /^Bedrock throttled the probe \(ThrottlingException: Too many requests/);
  assert.match(first.why, /probing again in 60 s$/);
  assert.doesNotMatch(first.why, /unreachable/i);

  mock.timers.tick(PROBE_RETRY_MS - 1000);
  const cached = await judgeMode();
  assert.equal(cached.mode, "mock");
  assert.match(cached.why, /probing again in 1 s$/);
  assert.equal(probes, 1, "no second probe inside the 60 s window");

  mock.timers.tick(1000);
  const after = await judgeMode();
  assert.equal(after.mode, "bedrock");
  assert.match(after.why, /\(probe \d+ ms\)$/);
  assert.equal(probes, 2);

  mock.timers.tick(PROBE_LASTING_RETRY_MS * 10);
  assert.equal((await judgeMode()).mode, "bedrock");
  assert.equal(probes, 2, "a good probe is kept for the process");
});

test("a 5xx on the probe is transient too", async () => {
  replies = [serverError()];
  const first = await judgeMode();
  assert.equal(first.mode, "mock");
  assert.match(first.why, /^Bedrock probe failed \(InternalServerException/);

  mock.timers.tick(PROBE_RETRY_MS);
  assert.equal((await judgeMode()).mode, "bedrock");
});

test("access denied mocks and only probes again after 5 min", async () => {
  replies = [denied(), denied()];

  const first = await judgeMode();
  assert.equal(first.mode, "mock");
  assert.match(first.why, /^Bedrock access missing \(AccessDeniedException/);
  assert.match(first.why, /probing again in 300 s$/);

  mock.timers.tick(PROBE_RETRY_MS);
  assert.equal((await judgeMode()).mode, "mock");
  assert.equal(probes, 1, "a lasting failure is not re-probed after 60 s");

  mock.timers.tick(PROBE_LASTING_RETRY_MS - PROBE_RETRY_MS);
  const again = await judgeMode();
  assert.equal(again.mode, "mock", "still denied on the second probe");
  assert.equal(probes, 2);

  mock.timers.tick(PROBE_LASTING_RETRY_MS);
  assert.equal((await judgeMode()).mode, "bedrock", "access granted without a restart");
  assert.equal(probes, 3);
});

test("COVERED_MOCK=1 forces mock and never probes", async () => {
  process.env.COVERED_MOCK = "1";
  assert.deepEqual(await judgeMode(), { mode: "mock", why: "COVERED_MOCK=1" });
  mock.timers.tick(PROBE_LASTING_RETRY_MS * 2);
  assert.deepEqual(await judgeMode(), { mode: "mock", why: "COVERED_MOCK=1" });
  assert.equal(probes, 0);
});

test("concurrent callers share one probe", async () => {
  const modes = await Promise.all([judgeMode(), judgeMode(), judgeMode()]);
  assert.deepEqual(modes.map((m) => m.mode), ["bedrock", "bedrock", "bedrock"]);
  assert.equal(probes, 1);
});

test("only access, model id and credentials failures are lasting", () => {
  assert.equal(probeFailureKind(denied()), "lasting");
  assert.equal(probeFailureKind(badModel()), "lasting");
  assert.equal(probeFailureKind(noCredentials()), "lasting");
  assert.equal(probeFailureKind(throttle()), "transient");
  assert.equal(probeFailureKind(awsError("Unknown", "slow down", 429)), "transient");
  assert.equal(probeFailureKind(serverError()), "transient");
  assert.equal(probeFailureKind(Object.assign(new Error("no answer in 10000 ms"), { name: "TimeoutError" })), "transient");
});
