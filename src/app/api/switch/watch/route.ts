/**
 * POST /api/switch/watch — the dashboard's price watcher (demo cadence, while the
 * page is open). Re-checks only orders whose demo-market price cut has come due
 * since their last check, through the real judge and switch rule, then returns the
 * watch list and the ids of orders worth an alert: a find that reaches the buyer's
 * switch minimum.
 *
 * Does not mint a `covered_uid`: no identity means nothing to watch.
 */
import { NextResponse } from "next/server";
import { isDenied, peekUserOr401 } from "@/lib/memory/identity";
import { getMemory } from "@/lib/memory";
import { runDueSwitchChecks, switchWatches, type SwitchWatch } from "@/lib/switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type WatchOk = { ok: true; watches: SwitchWatch[]; found: string[] };

export async function POST(request: Request): Promise<NextResponse<WatchOk | { ok: false; error: string }>> {
  const user = await peekUserOr401(request);
  if (isDenied(user)) return user;
  if (!user) return NextResponse.json({ ok: true, watches: [], found: [] });

  const checked = await runDueSwitchChecks(user.userId);
  const memory = await getMemory(user.userId);
  const minimum = memory.settings.switch_minimum_pence;
  const found = checked
    .filter((order) => (order.switch_check?.offer?.clear_pence ?? -1) >= minimum)
    .map((order) => order.id);
  return NextResponse.json({ ok: true, watches: switchWatches(memory), found });
}
