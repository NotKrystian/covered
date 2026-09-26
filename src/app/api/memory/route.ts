/**
 * /api/memory — owned by Judge+Memory. Preference memory for the anonymous `covered_uid`.
 *
 * GET    → the caller's `Memory` (decision events stripped) plus which store served it.
 * POST   `{ kind: "approve" | "override", query, chosen_id?, premium_pence, note?, display_name? }`
 *        → records the event, asks Bedrock (or the template) to rewrite `summary`, returns the memory.
 *        Approve is also written by POST /api/approve after a successful wallet debit.
 * DELETE → "Reset memory": removes the item and drops the cookie.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { clearUserId, getUserId } from "@/lib/memory/identity";
import {
  DISPLAY_NAME_MAX,
  NOTE_MAX,
  QUERY_MAX,
  deleteMemory,
  getMemory,
  memoryStore,
  publicMemory,
  recordEvent,
  saveMemory,
  type Memory,
} from "@/lib/memory";
import { rewriteSummary } from "@/lib/memory/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PostSchema = z.object({
  kind: z.enum(["approve", "override"]),
  query: z.string().min(1).max(QUERY_MAX),
  chosen_id: z.string().max(80).optional(),
  premium_pence: z.number().int().nonnegative(),
  note: z.string().max(NOTE_MAX).optional(),
  display_name: z.string().max(DISPLAY_NAME_MAX).optional(),
});

type MemoryResponse = {
  ok: true;
  memory: Memory;
  store: "dynamodb" | "local";
  /** Only on POST: how the summary was written. */
  summary_mode?: "bedrock" | "mock";
  notes?: string[];
};

export async function GET(): Promise<NextResponse<MemoryResponse>> {
  const { userId } = await getUserId();
  const memory = publicMemory(await getMemory(userId));
  return NextResponse.json({ ok: true, memory, store: memoryStore().store });
}

export async function POST(request: Request): Promise<NextResponse<MemoryResponse | { ok: false; error: string }>> {
  let body: z.infer<typeof PostSchema>;
  try {
    body = PostSchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "invalid body" }, { status: 400 });
  }

  const { userId } = await getUserId();
  const defaultNote =
    body.kind === "approve"
      ? `user approved ${body.chosen_id ?? "the pick"}`
      : `user overrode the bot and chose ${body.chosen_id ?? "another listing"}`;
  const withEvent = await recordEvent(
    userId,
    {
      kind: body.kind,
      query: body.query,
      chosen_id: body.chosen_id,
      premium_pence: body.premium_pence,
      note: body.note?.trim() || defaultNote,
    },
    { display_name: body.display_name },
  );

  const rewritten = await rewriteSummary(withEvent);
  const memory = publicMemory(await saveMemory(userId, { ...withEvent, summary: rewritten.summary }));
  console.log(`[covered/memory] ${body.kind} recorded for ${userId.slice(0, 8)}…, summary via ${rewritten.mode}`);
  return NextResponse.json({
    ok: true,
    memory,
    store: memoryStore().store,
    summary_mode: rewritten.mode,
    notes: rewritten.notes,
  });
}

export async function DELETE(): Promise<NextResponse<{ ok: true; store: "dynamodb" | "local" }>> {
  const { userId } = await getUserId();
  await deleteMemory(userId);
  await clearUserId();
  return NextResponse.json({ ok: true, store: memoryStore().store });
}
