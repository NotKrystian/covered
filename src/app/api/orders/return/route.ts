/**
 * POST /api/orders/return `{ order_id, kind }` — Send on the orders popup's return email.
 *
 * Re-checks `returnState` (so a stale popup cannot return what is no longer
 * eligible), then records the outcome on the order's aftercare. A refund path
 * (14-day return, or a fault rejected within 30 days) marks the order returned and
 * refunds the demo wallet; repair and replacement only record the request.
 * Nothing is sent to the shop: this is the demo ledger.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { isDenied, peekUserOr401 } from "@/lib/memory/identity";
import { AFTERCARE_MAX, getMemory, saveMemory, type OrderRecord } from "@/lib/memory";
import { returnNote, returnState } from "@/lib/returns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  order_id: z.string().min(1).max(80),
  kind: z.enum(["return", "fault_refund", "replace", "repair"]),
});

type ReturnOk = { ok: true; order: OrderRecord; balance_pence: number; note: string };
type ReturnErr = { ok: false; error: string };

export async function POST(request: Request): Promise<NextResponse<ReturnOk | ReturnErr>> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "invalid body" }, { status: 400 });
  }
  const user = await peekUserOr401(request);
  if (isDenied(user)) return user;
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const { userId } = user;

  const current = await getMemory(userId);
  const order = current.orders.find((o) => o.id === body.order_id);
  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

  const state = returnState(order);
  if (state.kind !== "open") return NextResponse.json({ ok: false, error: state.note }, { status: 409 });
  const option = state.options.find((o) => o.kind === body.kind);
  if (!option) {
    return NextResponse.json({ ok: false, error: "That option is not available for this order any more" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const note = returnNote(order, option);
  const refund = option.refund_pence;
  const saved = await saveMemory(userId, {
    ...current,
    balance_pence: current.balance_pence + (refund ?? 0),
    orders: current.orders.map((o) => {
      if (o.id !== order.id) return o;
      return {
        ...o,
        ...(refund !== null ? { cancelled_at: now, refund_pence: refund } : {}),
        aftercare: [
          ...(o.aftercare ?? []),
          { t: now, remedy: option.kind === "return" || option.kind === "fault_refund" ? ("refund" as const) : option.kind, refused: false, note },
        ].slice(-AFTERCARE_MAX),
      };
    }),
  });
  const updated = saved.orders.find((o) => o.id === order.id) ?? order;
  return NextResponse.json({ ok: true, order: updated, balance_pence: saved.balance_pence, note });
}
