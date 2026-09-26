/**
 * GET /api/reader/jobs/:id — one job for this user: `{ ok, job }`.
 * `job.status` is queued | running | done | failed | challenge. When `done`,
 * `job.result` is a `SearchResult` (`{ query, fetched_at, source: "live", offers, note }`)
 * ready for POST /api/decide. 404 when the id is unknown, expired, or another user's.
 */
import { NextResponse } from "next/server";
import { resolveUser, unauthorizedResponse } from "@/lib/memory/identity";
import { getJob, type ReaderJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobOk = { ok: true; job: ReaderJob };
type JobErr = { ok: false; error: string };

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse<JobOk | JobErr>> {
  const { id } = await ctx.params;
  let identity;
  try {
    identity = await resolveUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  const { userId } = identity;
  const job = await getJob(userId, id);
  if (!job) return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  return NextResponse.json({ ok: true, job });
}
