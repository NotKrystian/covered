/**
 * GET /api/orders — this buyer's approved orders (cookie covered_uid).
 * Source of truth: `orders[]` on the DynamoDB memory item, written on Approve.
 */
import { NextResponse } from "next/server";
import { getUserId } from "@/lib/memory/identity";
import { getMemory, type OrderRecord } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrdersResponse = {
  orders: OrderRecord[];
  total_pence: number;
  count: number;
};

export async function GET(): Promise<NextResponse<OrdersResponse>> {
  const { userId } = await getUserId();
  const memory = await getMemory(userId);
  const orders = [...memory.orders].reverse();
  const total_pence = memory.orders.reduce((sum, o) => sum + o.price_pence, 0);
  return NextResponse.json({ orders, total_pence, count: memory.orders.length });
}
