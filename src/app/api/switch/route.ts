/**
 * GET /api/switch — this buyer's 14-day price-drop watches: orders still inside
 * their cooling-off window, with the last check and any switch on offer.
 *
 * Does not mint a `covered_uid`; a missing cookie returns an empty list so the
 * extension's hourly poll never creates users.
 */
import { NextResponse } from "next/server";
import { peekUser, unauthorizedResponse } from "@/lib/memory/identity";
import { getMemory } from "@/lib/memory";
import { switchWatches, type SwitchWatch } from "@/lib/switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WatchesOk = { ok: true; watches: SwitchWatch[] };
type WatchesErr = { ok: false; error: string };

export async function GET(request: Request): Promise<NextResponse<WatchesOk | WatchesErr>> {
  let user;
  try {
    user = await peekUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  if (!user) return NextResponse.json({ ok: true, watches: [] });
  return NextResponse.json({ ok: true, watches: switchWatches(await getMemory(user.userId)) });
}
