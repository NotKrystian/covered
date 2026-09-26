/**
 * GET /api/limits — this buyer's watch-and-buy limits.
 * POST /api/limits `{ query, max_price_pence }` — store a new watching limit (cap 10).
 * DELETE /api/limits?id= — cancel one.
 *
 * GET does not mint a `covered_uid`; a missing cookie returns an empty list so
 * the extension's hourly poll never creates users.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { peekUser, resolveUser, unauthorizedResponse } from "@/lib/memory/identity";
import {
  LIMITS_MAX,
  LimitSchema,
  QUERY_MAX,
  getMemory,
  publicMemory,
  saveMemory,
  type Limit,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LimitsOk = { ok: true; limits: Limit[] };
type LimitsErr = { ok: false; error: string };

const PostSchema = z.object({
  query: z.string().min(1).max(QUERY_MAX),
  max_price_pence: z.number().int().nonnegative(),
});

export async function GET(request: Request): Promise<NextResponse<LimitsOk | LimitsErr>> {
  let user;
  try {
    user = await peekUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  if (!user) return NextResponse.json({ ok: true, limits: [] });
  const memory = publicMemory(await getMemory(user.userId));
  return NextResponse.json({ ok: true, limits: memory.limits });
}

export async function POST(request: Request): Promise<NextResponse<LimitsOk | LimitsErr>> {
  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "invalid body" },
      { status: 400 },
    );
  }

  let identity;
  try {
    identity = await resolveUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  const { userId } = identity;
  const current = await getMemory(userId);
  if (current.limits.length >= LIMITS_MAX) {
    return NextResponse.json({ ok: false, error: `At most ${LIMITS_MAX} limits` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const limit = LimitSchema.parse({
    id: crypto.randomUUID(),
    query: body.query.trim(),
    max_price_pence: body.max_price_pence,
    status: "watching",
    created_at: now,
    last_checked_at: "",
    last_result: "",
  });
  const saved = await saveMemory(userId, { ...current, limits: [...current.limits, limit] });
  return NextResponse.json({ ok: true, limits: publicMemory(saved).limits });
}

export async function DELETE(request: Request): Promise<NextResponse<LimitsOk | LimitsErr>> {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "Query param `id` is required" }, { status: 400 });
  }
  let user;
  try {
    user = await peekUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const userId = user.userId;
  const current = await getMemory(userId);
  if (!current.limits.some((limit) => limit.id === id)) {
    return NextResponse.json({ ok: false, error: "Limit not found" }, { status: 404 });
  }
  const saved = await saveMemory(userId, {
    ...current,
    limits: current.limits.filter((limit) => limit.id !== id),
  });
  return NextResponse.json({ ok: true, limits: publicMemory(saved).limits });
}
