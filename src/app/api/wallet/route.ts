/**
 * /api/wallet — demo ledger on the same DynamoDB memory item.
 *
 * GET  → { ok, balance_pence, deposits }
 * POST { amount_pence } → deposit (cap £500 per deposit, £2,000 balance, reject negative)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/memory/identity";
import { depositWallet, getMemory, memoryStore } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostSchema = z.object({
  amount_pence: z.number().int(),
});

type WalletOk = {
  ok: true;
  balance_pence: number;
  deposits: { t: string; amount_pence: number }[];
  store: "dynamodb" | "local";
};

export async function GET(): Promise<NextResponse<WalletOk>> {
  const { userId } = await getUserId();
  const memory = await getMemory(userId);
  return NextResponse.json({
    ok: true,
    balance_pence: memory.balance_pence,
    deposits: memory.deposits,
    store: memoryStore().store,
  });
}

export async function POST(request: Request): Promise<NextResponse<WalletOk | { ok: false; error: string }>> {
  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "invalid body" }, { status: 400 });
  }

  const { userId } = await getUserId();
  const result = await depositWallet(userId, body.amount_pence);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    balance_pence: result.memory.balance_pence,
    deposits: result.memory.deposits,
    store: memoryStore().store,
  });
}
