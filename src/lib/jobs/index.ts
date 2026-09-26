/**
 * Remote reader job queue — owned by the Reader/Extension agent.
 *
 * Any client (the iPhone app, Safari, a laptop without the extension) POSTs a
 * `{ query }` job. The paired Brave extension long-polls `/api/reader/jobs/next`,
 * opens an inactive Google Shopping tab in the user's own session, and POSTs the
 * offers back. The client polls the job until it is `done`, then calls
 * `/api/decide` with the offers exactly as the web dashboard does.
 *
 * Storage is the DynamoDB table `covered-jobs` (PK `user_id`, SK `job_id`, TTL
 * attribute `ttl`). Three item kinds share the table:
 *   - jobs:            job_id = "j<compact iso>-<hex>"  (sorts oldest first)
 *   - reader heartbeat: job_id = "reader"               (when the extension last polled)
 *   - pair-code index:  user_id = "pair#<CODE>", job_id = "code" -> target_user_id
 * Results larger than DynamoDB's item limit go to S3 at `jobs/{user_id}/{job_id}.json`.
 *
 * When DynamoDB is unreachable the store degrades to a per-process Map so mock
 * mode and local dev keep working; the trace/debug field `store` says which.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { BEDROCK_REGION } from "@/lib/judge/bedrock";
import { AWS_REGION, S3_BUCKET } from "@/lib/s3";
import { SearchResultSchema, type SearchResult } from "@/lib/types";

export const JOBS_TABLE = process.env.COVERED_JOBS_TABLE ?? "covered-jobs";
export const JOBS_REGION = BEDROCK_REGION;

/** A job lives 15 minutes, queued or not. */
export const JOB_TTL_MS = 15 * 60 * 1000;
/** At most this many queued jobs per user. */
export const QUEUED_MAX = 10;
/** A job still `running` this long after claim is reported as failed. */
export const RUNNING_STALE_MS = 90 * 1000;
/** Longest a `/next` long-poll may hold the connection. */
export const NEXT_WAIT_MAX_MS = 20_000;
const NEXT_POLL_INTERVAL_MS = 1_500;
/** Results above this many JSON bytes are written to S3 instead of the item. */
const INLINE_RESULT_MAX_BYTES = 300_000;
/** Heartbeat items live a day; "online" means seen inside READER_ONLINE_MS. */
const READER_TTL_MS = 24 * 60 * 60 * 1000;
export const READER_ONLINE_MS = 3 * 60 * 1000;
export const QUERY_MAX = 200;
export const ERROR_MAX = 200;

export const ReaderJobStatusSchema = z.enum(["queued", "running", "done", "failed", "challenge"]);
export type ReaderJobStatus = z.infer<typeof ReaderJobStatusSchema>;

export const ReaderJobSchema = z.object({
  job_id: z.string().min(1).max(64),
  user_id: z.string().min(1).max(64),
  query: z.string().min(1).max(QUERY_MAX),
  status: ReaderJobStatusSchema,
  /** ISO 8601 timestamps. */
  created_at: z.string(),
  claimed_at: z.string().optional(),
  finished_at: z.string().optional(),
  /** When the job falls out of the table. */
  expires_at: z.string(),
  /** Present when `status === "done"`. */
  result: SearchResultSchema.optional(),
  /** Present when `status` is `failed` or `challenge`. */
  error: z.string().max(ERROR_MAX).optional(),
});
export type ReaderJob = z.infer<typeof ReaderJobSchema>;

/** What the extension posts back: offers, or a reader error such as "challenge". */
export type JobOutcome =
  | { kind: "result"; result: SearchResult }
  | { kind: "error"; error: string };

export type JobsStore = "dynamodb" | "local";

type StoredJob = Omit<ReaderJob, "result"> & {
  result?: SearchResult;
  /** S3 key when the result was too large for the item. */
  result_key?: string;
  ttl: number;
};

const local = new Map<string, StoredJob>();
const localPairIndex = new Map<string, { target_user_id: string; expires_at: string }>();
const localReaderSeen = new Map<string, string>();
let docClient: DynamoDBDocumentClient | null = null;
let s3Client: S3Client | null = null;
let storeMode: JobsStore = "dynamodb";
let storeReason = "";

function client(): DynamoDBDocumentClient {
  if (docClient === null) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: JOBS_REGION }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

function s3(): S3Client {
  if (s3Client === null) s3Client = new S3Client({ region: AWS_REGION });
  return s3Client;
}

function fallBack(err: unknown): void {
  if (storeMode === "local") return;
  storeMode = "local";
  storeReason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.warn(`[covered/jobs] DynamoDB unavailable, using in-process jobs: ${storeReason}`);
}

/** Which store is live right now and, when local, why. */
export function jobsStore(): { store: JobsStore; reason: string } {
  return { store: storeMode, reason: storeReason };
}

function ttlSeconds(atMs: number): number {
  return Math.floor(atMs / 1000);
}

function localKey(userId: string, jobId: string): string {
  return `${userId}|${jobId}`;
}

function pruneLocal(now: number): void {
  for (const [key, job] of local) {
    if (job.ttl * 1000 <= now) local.delete(key);
  }
  for (const [code, entry] of localPairIndex) {
    if (Date.parse(entry.expires_at) <= now) localPairIndex.delete(code);
  }
}

/** Sortable id: compact ISO time then 4 random bytes. Oldest first under lexical order. */
export function newJobId(now: Date = new Date()): string {
  const compact = now.toISOString().replace(/[-:.]/g, "");
  return `j${compact}-${randomBytes(4).toString("hex")}`;
}

function isJobSk(sk: string): boolean {
  return sk.startsWith("j");
}

function resultKey(userId: string, jobId: string): string {
  return `jobs/${userId}/${jobId}.json`;
}

/** Drop image bytes so a result always fits the item when S3 is unavailable. */
function stripPhotos(result: SearchResult): SearchResult {
  return {
    ...result,
    offers: result.offers.map((offer) => ({ ...offer, image_data_url: null })),
    note: `${result.note ? `${result.note}; ` : ""}photos dropped: result store unavailable`,
  };
}

/** Public view: stale running jobs read as failed; the S3 result is inlined. */
async function toPublic(stored: StoredJob, now: number): Promise<ReaderJob> {
  const { result_key, ttl: _ttl, ...rest } = stored;
  void _ttl;
  let job: ReaderJob = { ...rest };
  if (job.status === "running" && job.claimed_at && now - Date.parse(job.claimed_at) > RUNNING_STALE_MS) {
    job = { ...job, status: "failed", error: "reader timed out" };
  }
  if (job.status === "done" && !job.result && result_key) {
    const fetched = await readResultFromS3(result_key);
    job = fetched ? { ...job, result: fetched } : { ...job, status: "failed", error: "result unavailable" };
  }
  return job;
}

async function readResultFromS3(key: string): Promise<SearchResult | null> {
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const text = await out.Body?.transformToString();
    if (!text) return null;
    const parsed = SearchResultSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch (err) {
    console.warn(`[covered/jobs] S3 read failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function writeResultToS3(key: string, result: SearchResult): Promise<boolean> {
  try {
    await s3().send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: JSON.stringify(result),
        ContentType: "application/json",
      }),
    );
    return true;
  } catch (err) {
    console.warn(`[covered/jobs] S3 write failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function queryUserJobs(userId: string): Promise<StoredJob[]> {
  const now = Date.now();
  if (storeMode === "dynamodb") {
    try {
      const out = await client().send(
        new QueryCommand({
          TableName: JOBS_TABLE,
          KeyConditionExpression: "user_id = :u AND begins_with(job_id, :p)",
          ExpressionAttributeValues: { ":u": userId, ":p": "j" },
          ScanIndexForward: true,
        }),
      );
      return ((out.Items ?? []) as StoredJob[]).filter((item) => item.ttl * 1000 > now);
    } catch (err) {
      fallBack(err);
    }
  }
  pruneLocal(now);
  return [...local.values()]
    .filter((job) => job.user_id === userId && isJobSk(job.job_id))
    .sort((a, b) => (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0));
}

async function getStored(userId: string, jobId: string): Promise<StoredJob | null> {
  const now = Date.now();
  if (storeMode === "dynamodb") {
    try {
      const out = await client().send(
        new GetCommand({ TableName: JOBS_TABLE, Key: { user_id: userId, job_id: jobId } }),
      );
      const item = out.Item as StoredJob | undefined;
      if (!item || item.ttl * 1000 <= now) return null;
      return item;
    } catch (err) {
      fallBack(err);
    }
  }
  pruneLocal(now);
  return local.get(localKey(userId, jobId)) ?? null;
}

async function putStored(job: StoredJob): Promise<void> {
  if (storeMode === "dynamodb") {
    try {
      await client().send(new PutCommand({ TableName: JOBS_TABLE, Item: job }));
      return;
    } catch (err) {
      fallBack(err);
    }
  }
  local.set(localKey(job.user_id, job.job_id), job);
}

export type CreateJobResult =
  | { ok: true; job: ReaderJob }
  | { ok: false; error: string; status: number };

/** Queue a read for this user. Rejects when QUEUED_MAX jobs are already waiting. */
export async function createJob(userId: string, query: string): Promise<CreateJobResult> {
  const q = query.trim().slice(0, QUERY_MAX);
  if (!q) return { ok: false, error: "query is required", status: 400 };
  const queued = (await queryUserJobs(userId)).filter((job) => job.status === "queued");
  if (queued.length >= QUEUED_MAX) {
    return { ok: false, error: `At most ${QUEUED_MAX} queued jobs`, status: 429 };
  }
  const now = new Date();
  const expires = new Date(now.getTime() + JOB_TTL_MS);
  const stored: StoredJob = {
    job_id: newJobId(now),
    user_id: userId,
    query: q,
    status: "queued",
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    ttl: ttlSeconds(expires.getTime()),
  };
  await putStored(stored);
  return { ok: true, job: await toPublic(stored, now.getTime()) };
}

/** One job by id, or null when unknown / expired / another user's. */
export async function getJob(userId: string, jobId: string): Promise<ReaderJob | null> {
  const stored = await getStored(userId, jobId);
  return stored ? toPublic(stored, Date.now()) : null;
}

/** Newest-first list for debugging and the popup. */
export async function listJobs(userId: string): Promise<ReaderJob[]> {
  const now = Date.now();
  const stored = await queryUserJobs(userId);
  const out: ReaderJob[] = [];
  for (const job of stored.reverse()) out.push(await toPublic(job, now));
  return out;
}

/**
 * Mark the oldest queued job `running` and return it. A conditional update means two
 * readers on the same user never both get the same job.
 */
export async function claimNextJob(userId: string): Promise<ReaderJob | null> {
  const queued = (await queryUserJobs(userId)).filter((job) => job.status === "queued");
  const claimedAt = new Date().toISOString();
  for (const job of queued) {
    if (storeMode === "dynamodb") {
      try {
        const out = await client().send(
          new UpdateCommand({
            TableName: JOBS_TABLE,
            Key: { user_id: userId, job_id: job.job_id },
            ConditionExpression: "#s = :queued",
            UpdateExpression: "SET #s = :running, claimed_at = :t",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: { ":queued": "queued", ":running": "running", ":t": claimedAt },
            ReturnValues: "ALL_NEW",
          }),
        );
        if (out.Attributes) return toPublic(out.Attributes as StoredJob, Date.now());
        continue;
      } catch (err) {
        if (err instanceof Error && err.name === "ConditionalCheckFailedException") continue;
        fallBack(err);
      }
    }
    const key = localKey(userId, job.job_id);
    const current = local.get(key);
    if (!current || current.status !== "queued") continue;
    const next: StoredJob = { ...current, status: "running", claimed_at: claimedAt };
    local.set(key, next);
    return toPublic(next, Date.now());
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Long-poll: claim the next job, retrying every 1.5 s for up to `waitMs` (capped at 20 s). */
export async function waitForNextJob(userId: string, waitMs: number): Promise<ReaderJob | null> {
  const deadline = Date.now() + Math.max(0, Math.min(NEXT_WAIT_MAX_MS, waitMs));
  for (;;) {
    const job = await claimNextJob(userId);
    if (job) return job;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    await sleep(Math.min(NEXT_POLL_INTERVAL_MS, remaining));
  }
}

/**
 * Record what the reader found. Offers become a `done` result; `"challenge"` becomes
 * status `challenge`; any other error is `failed`. Returns null when the job is unknown.
 */
export async function completeJob(
  userId: string,
  jobId: string,
  outcome: JobOutcome,
): Promise<ReaderJob | null> {
  const current = await getStored(userId, jobId);
  if (!current) return null;
  const finishedAt = new Date().toISOString();
  let next: StoredJob;
  switch (outcome.kind) {
    case "result": {
      const encoded = JSON.stringify(outcome.result);
      if (encoded.length <= INLINE_RESULT_MAX_BYTES || storeMode === "local") {
        next = { ...current, status: "done", finished_at: finishedAt, result: outcome.result, error: undefined };
      } else {
        const key = resultKey(userId, jobId);
        const written = await writeResultToS3(key, outcome.result);
        next = written
          ? { ...current, status: "done", finished_at: finishedAt, result: undefined, result_key: key, error: undefined }
          : { ...current, status: "done", finished_at: finishedAt, result: stripPhotos(outcome.result), error: undefined };
      }
      break;
    }
    case "error": {
      const error = outcome.error.trim().slice(0, ERROR_MAX) || "unknown";
      next = {
        ...current,
        status: error === "challenge" ? "challenge" : "failed",
        finished_at: finishedAt,
        error,
        result: undefined,
        result_key: undefined,
      };
      break;
    }
    default: {
      const never: never = outcome;
      throw new Error(`unknown outcome ${String(never)}`);
    }
  }
  await putStored(next);
  return toPublic(next, Date.now());
}

/** Note that this user's reader polled just now. */
export async function touchReader(userId: string): Promise<void> {
  const nowMs = Date.now();
  const seenAt = new Date(nowMs).toISOString();
  if (storeMode === "dynamodb") {
    try {
      await client().send(
        new PutCommand({
          TableName: JOBS_TABLE,
          Item: { user_id: userId, job_id: "reader", seen_at: seenAt, ttl: ttlSeconds(nowMs + READER_TTL_MS) },
        }),
      );
      return;
    } catch (err) {
      fallBack(err);
    }
  }
  localReaderSeen.set(userId, seenAt);
}

/** When this user's reader last polled, or null if never. */
export async function readerSeenAt(userId: string): Promise<string | null> {
  if (storeMode === "dynamodb") {
    try {
      const out = await client().send(
        new GetCommand({ TableName: JOBS_TABLE, Key: { user_id: userId, job_id: "reader" } }),
      );
      const item = out.Item as { seen_at?: string; ttl?: number } | undefined;
      if (!item || typeof item.seen_at !== "string") return null;
      if (typeof item.ttl === "number" && item.ttl * 1000 <= Date.now()) return null;
      return item.seen_at;
    } catch (err) {
      fallBack(err);
    }
  }
  return localReaderSeen.get(userId) ?? null;
}

export function readerOnline(seenAt: string | null, now: number = Date.now()): boolean {
  return seenAt !== null && now - Date.parse(seenAt) <= READER_ONLINE_MS;
}

// ---- pair-code index ---------------------------------------------------------

function pairPk(code: string): string {
  return `pair#${code}`;
}

/** Index a pair code so /api/pair/claim can find the user without scanning. */
export async function putPairIndex(code: string, targetUserId: string, expiresAt: string): Promise<void> {
  const ttl = ttlSeconds(Date.parse(expiresAt));
  if (storeMode === "dynamodb") {
    try {
      await client().send(
        new PutCommand({
          TableName: JOBS_TABLE,
          Item: { user_id: pairPk(code), job_id: "code", target_user_id: targetUserId, expires_at: expiresAt, ttl },
        }),
      );
      return;
    } catch (err) {
      fallBack(err);
    }
  }
  localPairIndex.set(code, { target_user_id: targetUserId, expires_at: expiresAt });
}

/** Which user issued this code, or null when unknown / expired. */
export async function lookupPairIndex(code: string): Promise<string | null> {
  const now = Date.now();
  if (storeMode === "dynamodb") {
    try {
      const out = await client().send(
        new GetCommand({ TableName: JOBS_TABLE, Key: { user_id: pairPk(code), job_id: "code" } }),
      );
      const item = out.Item as { target_user_id?: string; expires_at?: string } | undefined;
      if (!item || typeof item.target_user_id !== "string") return null;
      if (typeof item.expires_at === "string" && Date.parse(item.expires_at) <= now) return null;
      return item.target_user_id;
    } catch (err) {
      fallBack(err);
    }
  }
  pruneLocal(now);
  return localPairIndex.get(code)?.target_user_id ?? null;
}

/** Remove a claimed code from the index. */
export async function deletePairIndex(code: string): Promise<void> {
  localPairIndex.delete(code);
  if (storeMode === "dynamodb") {
    try {
      await client().send(
        new DeleteCommand({ TableName: JOBS_TABLE, Key: { user_id: pairPk(code), job_id: "code" } }),
      );
    } catch (err) {
      fallBack(err);
    }
  }
}
