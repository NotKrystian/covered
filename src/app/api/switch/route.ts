/**
 * GET /api/switch — this buyer's 14-day price-drop watches: orders still inside
 * their cooling-off window, with the last check and any switch on offer.
 *
 * Does not mint a `covered_uid`; a missing cookie returns an empty list so the
 * extension's hourly poll never creates users.
 */
import { NextResponse } from "next/server";
import { peekUserId } from "@/lib/memory/identity";
import { getMemory } from "@/lib/memory";
import { switchWatches, type SwitchWatch } from "@/lib/switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<{ ok: true; watches: SwitchWatch[] }>> {
  const userId = await peekUserId();
  if (!userId) return NextResponse.json({ ok: true, watches: [] });
  return NextResponse.json({ ok: true, watches: switchWatches(await getMemory(userId)) });
}
