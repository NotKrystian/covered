/**
 * POST /api/switch/accept `{ order_id }` — perform the switch on offer: cancel the
 * first order under the 14-day right (refund minus return postage to the demo
 * wallet), buy the new listing, and link the two orders. 402 if the wallet, after
 * the refund, still cannot cover the new price.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { peekUser, unauthorizedResponse } from "@/lib/memory/identity";
import { acceptSwitch } from "@/lib/switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({ order_id: z.string().min(1).max(80) });

type AcceptOk = { ok: true; new_order_id: string; refund_pence: number; clear_pence: number; balance_pence: number };
type AcceptErr = { ok: false; error: string };

export async function POST(request: Request): Promise<NextResponse<AcceptOk | AcceptErr>> {
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

  const result = await acceptSwitch(user.userId, body.order_id);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
