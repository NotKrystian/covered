/**
 * Client for the remote reader queue (`/api/reader/jobs`). Used when the Covered
 * extension is not in THIS browser: the job is picked up by the user's paired Brave.
 * The iOS app follows the same three calls with `Authorization: Bearer <token>`.
 */
import { SearchResultSchema } from "@/lib/types";
import type { SearchAttempt } from "@/lib/client/shop";

export const REMOTE_READ_TIMEOUT_MS = 45_000;
export const REMOTE_POLL_INTERVAL_MS = 1_000;

/** Reason strings this module can return in `{ ok: false, reason }`. */
export const REMOTE_READER_OFFLINE = "reader_offline";

type CreateResponse =
  | { ok: true; job_id: string; reader_online: boolean; reader_seen_at: string | null }
  | { ok: false; error: string };

type JobResponse =
  | {
      ok: true;
      job: { job_id: string; status: "queued" | "running" | "done" | "failed" | "challenge"; result?: unknown; error?: string };
    }
  | { ok: false; error: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createReaderJob(query: string): Promise<CreateResponse> {
  try {
    const res = await fetch("/api/reader/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const json = (await res.json().catch(() => null)) as CreateResponse | null;
    if (!json) return { ok: false, error: `reader queue answered ${res.status}` };
    return json;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchReaderJob(jobId: string): Promise<JobResponse> {
  try {
    const res = await fetch(`/api/reader/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const json = (await res.json().catch(() => null)) as JobResponse | null;
    if (!json) return { ok: false, error: `job lookup answered ${res.status}` };
    return json;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Queue a read and poll it to completion. Returns `reader_offline` at once when no
 * paired extension has polled in the last few minutes, so callers can fall back fast.
 */
export async function readViaRemoteReader(
  query: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<SearchAttempt> {
  const timeoutMs = opts.timeoutMs ?? REMOTE_READ_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? REMOTE_POLL_INTERVAL_MS;
  const created = await createReaderJob(query);
  if (!created.ok) return { ok: false, reason: `remote_failed: ${created.error}` };
  if (!created.reader_online) return { ok: false, reason: REMOTE_READER_OFFLINE };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const polled = await fetchReaderJob(created.job_id);
    if (!polled.ok) return { ok: false, reason: `remote_failed: ${polled.error}` };
    const job = polled.job;
    switch (job.status) {
      case "queued":
      case "running":
        continue;
      case "done": {
        const parsed = SearchResultSchema.safeParse(job.result);
        if (!parsed.success) return { ok: false, reason: "remote_failed: result did not parse" };
        if (parsed.data.offers.length === 0) return { ok: false, reason: "no_offers: grid was empty" };
        return { ok: true, result: parsed.data };
      }
      case "challenge":
        return { ok: false, reason: "challenge" };
      case "failed":
        return { ok: false, reason: `remote_failed: ${job.error ?? "reader failed"}` };
      default: {
        const never: never = job.status;
        return { ok: false, reason: `remote_failed: ${String(never)}` };
      }
    }
  }
  return { ok: false, reason: "remote_timeout: your paired browser did not answer in 45 s" };
}
