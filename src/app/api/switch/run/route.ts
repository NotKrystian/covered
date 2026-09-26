/**
 * POST /api/switch/run `{ order_id, offers }` — judge a fresh grid for the order's
 * query (read in the buyer's browser, or by the extension's hourly alarm) and store
 * whether a switch clears the buyer's minimum after return postage.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { OfferSchema } from "@/lib/types";
import { peekUser, unauthorizedResponse } from "@/lib/memory/identity";
import type { OrderRecord } from "@/lib/memory";
import { runSwitchCheck } from "@/lib/switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  order_id: z.string().min(1).max(80),
  offers: z.array(OfferSchema),
});

type RunOk = { ok: true; order: OrderRecord; found: boolean };
type RunErr = { ok: false; error: string };

export async function POST(request: Request): Promise<NextResponse<RunOk | RunErr>> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "invalid body" }, { status: 400 });
  }
  let user;
  try {
    user = await peekUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const result = await runSwitchCheck(user.userId, body.order_id, body.offers, { simulated: false });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, order: result.order, found: result.found });
}
