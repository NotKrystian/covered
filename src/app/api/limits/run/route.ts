/**
 * POST /api/limits/run `{ id, offers }` — judge the offered grid (ads included),
 * apply the same pound rule as /api/decide, and buy if the chosen listing is
 * at or below the limit and the wallet covers it.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { OfferSchema } from "@/lib/types";
import { peekUserId } from "@/lib/memory/identity";
import { type Limit } from "@/lib/memory";
import { runLimitAgainstOffers } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  id: z.string().min(1).max(80),
  offers: z.array(OfferSchema),
});

type RunOk = { ok: true; limit: Limit; filled: boolean; balance_pence?: number };
type RunErr = { ok: false; error: string; limit?: Limit };

export async function POST(request: Request): Promise<NextResponse<RunOk | RunErr>> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "invalid body" },
      { status: 400 },
    );
  }

  const userId = await peekUserId();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const result = await runLimitAgainstOffers(userId, body.id, body.offers);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, limit: result.limit },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    limit: result.limit,
    filled: result.filled,
    balance_pence: result.balance_pence,
  });
}
