/**
 * POST /api/switch/simulate `{ order_id }` — the labelled demo. Builds the same
 * listing at a lower price on the server and runs it through the real judge and
 * the real switch rule. The stored result is marked `simulated` and the UI says so.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { peekUserId } from "@/lib/memory/identity";
import { getMemory, type OrderRecord } from "@/lib/memory";
import { runSwitchCheck } from "@/lib/switch";
import { simulatedDropOffers } from "@/lib/switch-rule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({ order_id: z.string().min(1).max(80) });

type SimOk = { ok: true; order: OrderRecord; found: boolean };
type SimErr = { ok: false; error: string };

export async function POST(request: Request): Promise<NextResponse<SimOk | SimErr>> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "invalid body" }, { status: 400 });
  }
  const userId = await peekUserId();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const order = (await getMemory(userId)).orders.find((o) => o.id === body.order_id);
  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

  const result = await runSwitchCheck(userId, order.id, simulatedDropOffers(order), { simulated: true });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, order: result.order, found: result.found });
}
