/**
 * POST /api/orders/assist — draft a returns / fault letter for an approved order.
 * Records aftercare[] on the order. Does not write an approve event or debit the wallet.
 */
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/memory/identity";
import { getMemory, recordAftercare } from "@/lib/memory";
import {
  AftercareAssistRequestSchema,
  emptyOrdersAssist,
  runAftercareAssist,
  toAftercareEntry,
  type AftercareAssist,
} from "@/lib/aftercare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AssistOk = AftercareAssist & { mode: "bedrock" | "mock"; why: string; order_id: string | null };
type AssistErr = { error: string };

export async function POST(request: Request): Promise<NextResponse<AssistOk | AssistErr>> {
  let body: ReturnType<typeof AftercareAssistRequestSchema.parse>;
  try {
    body = AftercareAssistRequestSchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { userId } = await getUserId();
  const memory = await getMemory(userId);
  if (memory.orders.length === 0) {
    return NextResponse.json({ ...emptyOrdersAssist(), mode: "mock", why: "no approved orders to help with", order_id: null });
  }

  const selected =
    (body.order_id ? memory.orders.find((o) => o.id === body.order_id) : undefined) ??
    memory.orders[memory.orders.length - 1];
  if (body.order_id && !memory.orders.some((o) => o.id === body.order_id)) {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }

  const { result, mode, why } = await runAftercareAssist({
    order: selected,
    settings: memory.settings,
    message: body.message,
    history: body.history,
    orders: memory.orders,
  });

  await recordAftercare(userId, selected.id, toAftercareEntry(result));
  return NextResponse.json({ ...result, mode, why, order_id: selected.id });
}
