/**
 * POST /api/pair/start — the Brave extension (with its `covered_uid` cookie) asks for a
 * 6-character pair code. Returns `{ ok, code, expires_at, user_id }`. The phone claims the
 * code at POST /api/pair/claim and becomes this same user. Codes live 10 minutes.
 *
 * GET /api/pair/start — connection check for the popup: `{ ok, connected, user_id?,
 * paired_devices, reader_seen_at }`. Does not mint a user.
 */
import { NextResponse } from "next/server";
import { peekUser, resolveUser, unauthorizedResponse } from "@/lib/memory/identity";
import { getMemory } from "@/lib/memory";
import { readerSeenAt } from "@/lib/jobs";
import { startPairing } from "@/lib/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StartOk = { ok: true; code: string; expires_at: string; user_id: string };
type StatusOk = {
  ok: true;
  connected: boolean;
  user_id?: string;
  paired_devices: number;
  reader_seen_at: string | null;
};

export async function POST(request: Request): Promise<NextResponse<StartOk | { ok: false; error: string }>> {
  let identity;
  try {
    identity = await resolveUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  const { userId } = identity;
  const started = await startPairing(userId);
  return NextResponse.json({ ok: true, code: started.code, expires_at: started.expires_at, user_id: userId });
}

export async function GET(request: Request): Promise<NextResponse<StatusOk | { ok: false; error: string }>> {
  let user;
  try {
    user = await peekUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
  if (!user) {
    return NextResponse.json({ ok: true, connected: false, paired_devices: 0, reader_seen_at: null });
  }
  const memory = await getMemory(user.userId);
  return NextResponse.json({
    ok: true,
    connected: true,
    user_id: user.userId,
    paired_devices: (memory.device_tokens ?? []).length,
    reader_seen_at: await readerSeenAt(user.userId),
  });
}
