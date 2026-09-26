/**
 * POST /api/pair/claim `{ code, label? }` — the phone (or any second client) enters the
 * code from the extension popup and becomes the SAME Covered user.
 *
 * Response `{ ok, user_id, token, expires_in }` plus `Set-Cookie: covered_uid=<user_id>`
 * for clients that hold cookies. Clients that cannot (the iOS app) keep `token` and send
 * `Authorization: Bearer <token>` on every /api call instead. Tokens do not expire but
 * at most 5 are kept per user; the oldest is dropped when a sixth device pairs.
 *
 * Errors: 400 bad shape, 404 unknown code, 410 expired / already used.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { setUserCookie } from "@/lib/memory/identity";
import { DEVICE_LABEL_MAX } from "@/lib/memory";
import { claimPairing } from "@/lib/pairing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  code: z.string().min(1).max(12),
  /** e.g. "iPhone". Shown nowhere yet; kept so a device list can exist later. */
  label: z.string().max(DEVICE_LABEL_MAX).optional(),
});

type ClaimOk = { ok: true; user_id: string; token: string; token_type: "Bearer"; paired_devices: number };
type ClaimErr = { ok: false; error: string };

export async function POST(request: Request): Promise<NextResponse<ClaimOk | ClaimErr>> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "body must be JSON: { code }" },
      { status: 400 },
    );
  }

  const claimed = await claimPairing(body.code, body.label);
  if (!claimed.ok) {
    return NextResponse.json({ ok: false, error: claimed.error }, { status: claimed.status });
  }
  await setUserCookie(claimed.user_id);
  return NextResponse.json({
    ok: true,
    user_id: claimed.user_id,
    token: claimed.token,
    token_type: "Bearer",
    paired_devices: (claimed.memory.device_tokens ?? []).length,
  });
}
