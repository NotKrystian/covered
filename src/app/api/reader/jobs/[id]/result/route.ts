/**
 * POST /api/reader/jobs/:id/result — the extension reports what it read.
 *   `{ offers: Offer[] }` → status `done`, `result` is the ingested SearchResult
 *   `{ error: "challenge" }` → status `challenge` (Google asked for a check; never bypassed)
 *   `{ error: "<anything else>" }` → status `failed`
 * Offers go through the same parse/dedupe/cap as POST /api/search with client offers.
 * Returns `{ ok, job_id, status, offers }` (the count, not the rows). 404 if the job is
 * unknown, expired, or belongs to another user. Never mints a user.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { peekUser, unauthorizedResponse } from "@/lib/memory/identity";
import { ERROR_MAX, completeJob, getJob, type JobOutcome, type ReaderJobStatus } from "@/lib/jobs";
import { ingestClientOffers } from "@/lib/reader/ingest";
import { OfferSchema } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.union([
  z.object({ offers: z.array(OfferSchema) }),
  z.object({ error: z.string().min(1).max(ERROR_MAX) }),
]);

type ResultOk = { ok: true; job_id: string; status: ReaderJobStatus; offers: number };
type ResultErr = { ok: false; error: string };

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse<ResultOk | ResultErr>> {
  const { id } = await ctx.params;
  let user;
  try {
    user = await peekUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  if (!user) return NextResponse.json({ ok: false, error: "not_connected" }, { status: 401 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "body must be { offers } or { error }" },
      { status: 400 },
    );
  }

  let outcome: JobOutcome;
  let offerCount = 0;
  if ("offers" in body) {
    if (body.offers.length === 0) {
      outcome = { kind: "error", error: "no_offers" };
    } else {
      const current = await getJob(user.userId, id);
      if (!current) return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
      const result = ingestClientOffers(current.query, body.offers);
      offerCount = result.offers.length;
      outcome = { kind: "result", result };
    }
  } else {
    outcome = { kind: "error", error: body.error };
  }

  const job = await completeJob(user.userId, id, outcome);
  if (!job) return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  return NextResponse.json({ ok: true, job_id: job.job_id, status: job.status, offers: offerCount });
}
