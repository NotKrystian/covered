/**
 * GET /api/reader/jobs/next?wait=20 — the extension's long-poll for work.
 *
 * Marks the oldest queued job for this user `running` and returns `{ ok, job }` (200).
 * Holds the connection up to `wait` seconds (max 20) waiting for one; 204 when none.
 * 401 when the caller has no `covered_uid` cookie or bearer token: this route never
 * mints users, so a fresh browser must open the Covered site (or the popup) first.
 * Every call also records a reader heartbeat so job creators can see the reader is online.
 */
import { NextResponse } from "next/server";
import { peekUser, unauthorizedResponse } from "@/lib/memory/identity";
import { NEXT_WAIT_MAX_MS, touchReader, waitForNextJob, type ReaderJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type NextOk = { ok: true; job: ReaderJob };
type NextErr = { ok: false; error: string };

export async function GET(request: Request): Promise<NextResponse<NextOk | NextErr> | Response> {
  let user;
  try {
    user = await peekUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  if (!user) {
    return NextResponse.json({ ok: false, error: "not_connected" }, { status: 401 });
  }
  const waitParam = Number(new URL(request.url).searchParams.get("wait") ?? "0");
  const waitMs = Number.isFinite(waitParam) ? Math.max(0, Math.min(NEXT_WAIT_MAX_MS, waitParam * 1000)) : 0;

  await touchReader(user.userId);
  const job = await waitForNextJob(user.userId, waitMs);
  if (!job) return new Response(null, { status: 204 });
  return NextResponse.json({ ok: true, job });
}
