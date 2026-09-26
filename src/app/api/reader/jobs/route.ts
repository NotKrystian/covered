/**
 * POST /api/reader/jobs `{ query }` — queue a Google Shopping read for this user's paired
 * Brave extension. Any client: cookie or `Authorization: Bearer <token>`.
 * Returns `{ ok, job_id, status: "queued", expires_at, reader_seen_at, reader_online }`.
 * Poll GET /api/reader/jobs/:id every second, up to ~45 s, until `status` leaves
 * `queued`/`running`; then POST /api/decide with `job.result.offers` as the web does.
 *
 * GET /api/reader/jobs — this user's recent jobs, newest first (debug / popup).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveUser, unauthorizedResponse } from "@/lib/memory/identity";
import {
  QUERY_MAX,
  createJob,
  jobsStore,
  listJobs,
  readerOnline,
  readerSeenAt,
  type ReaderJob,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  query: z.string().trim().min(1).max(QUERY_MAX),
});

type CreateOk = {
  ok: true;
  job_id: string;
  status: ReaderJob["status"];
  created_at: string;
  expires_at: string;
  /** When this user's extension last polled for work; null if never. */
  reader_seen_at: string | null;
  /** True when the reader polled inside the last 3 minutes, so the job should land soon. */
  reader_online: boolean;
  store: "dynamodb" | "local";
};
type JobsErr = { ok: false; error: string };
type ListOk = { ok: true; jobs: Omit<ReaderJob, "result">[]; reader_seen_at: string | null; reader_online: boolean };

export async function POST(request: Request): Promise<NextResponse<CreateOk | JobsErr>> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "body must be JSON: { query }" },
      { status: 400 },
    );
  }

  let identity;
  try {
    identity = await resolveUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  const { userId } = identity;
  const created = await createJob(userId, body.query);
  if (!created.ok) {
    return NextResponse.json({ ok: false, error: created.error }, { status: created.status });
  }
  const seenAt = await readerSeenAt(userId);
  return NextResponse.json(
    {
      ok: true,
      job_id: created.job.job_id,
      status: created.job.status,
      created_at: created.job.created_at,
      expires_at: created.job.expires_at,
      reader_seen_at: seenAt,
      reader_online: readerOnline(seenAt),
      store: jobsStore().store,
    },
    { status: 201 },
  );
}

export async function GET(request: Request): Promise<NextResponse<ListOk | JobsErr>> {
  let identity;
  try {
    identity = await resolveUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  const { userId } = identity;
  const jobs = (await listJobs(userId)).map((job) => {
    const { result: _result, ...rest } = job;
    void _result;
    return rest;
  });
  const seenAt = await readerSeenAt(userId);
  return NextResponse.json({ ok: true, jobs, reader_seen_at: seenAt, reader_online: readerOnline(seenAt) });
}
