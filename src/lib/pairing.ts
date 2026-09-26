/**
 * Pairing: one Covered user, two devices.
 *
 * The Brave extension asks for a 6-character code (`startPairing`). The phone types
 * it (`claimPairing`) and becomes the SAME user: the server answers with the user id,
 * sets the `covered_uid` cookie for cookie-capable clients, and mints a bearer token
 * for clients that cannot hold cookies. Codes live 10 minutes and are single use.
 * Tokens are `<user_id>.<secret>`; only the sha256 of `<secret>` is stored.
 */
import { randomBytes, randomInt } from "node:crypto";
import { hashTokenSecret } from "@/lib/memory/identity";
import {
  PAIR_CODE_TTL_MS,
  addPairCode,
  claimPairCode,
  type DeviceToken,
  type Memory,
} from "@/lib/memory";
import { deletePairIndex, lookupPairIndex, putPairIndex } from "@/lib/jobs";

/** No 0/O/1/I so the code survives being read aloud. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIR_CODE_LENGTH = 6;

export function newPairCode(): string {
  let code = "";
  for (let i = 0; i < PAIR_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Uppercase and strip spaces and dashes; the alphabet has no look-alikes to fix. */
export function normalizePairCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").slice(0, PAIR_CODE_LENGTH);
}

export function isPairCodeShape(code: string): boolean {
  return code.length === PAIR_CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

/** 32 random bytes, base64url (43 chars). */
export function newTokenSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function formatDeviceToken(userId: string, secret: string): string {
  return `${userId}.${secret}`;
}

export type PairStart = { code: string; expires_at: string };

/** Issue a code for `userId` (the extension's identity) and index it for claim. */
export async function startPairing(userId: string): Promise<PairStart> {
  const code = newPairCode();
  const expires_at = new Date(Date.now() + PAIR_CODE_TTL_MS).toISOString();
  await addPairCode(userId, { code, expires_at });
  await putPairIndex(code, userId, expires_at);
  return { code, expires_at };
}

export type PairClaim =
  | { ok: true; user_id: string; token: string; memory: Memory }
  | { ok: false; error: string; status: number };

/** Consume a code: the caller becomes that user and receives a fresh device token. */
export async function claimPairing(rawCode: string, label?: string): Promise<PairClaim> {
  const code = normalizePairCode(rawCode);
  if (!isPairCodeShape(code)) {
    return { ok: false, error: "Enter the 6-character code from the Covered reader popup", status: 400 };
  }
  const userId = await lookupPairIndex(code);
  if (!userId) return { ok: false, error: "That code is not live. Open the popup for a fresh one.", status: 404 };

  const secret = newTokenSecret();
  const token: DeviceToken = {
    hash: hashTokenSecret(secret),
    created_at: new Date().toISOString(),
    label: label?.trim() ? label.trim() : undefined,
  };
  const memory = await claimPairCode(userId, code, token);
  if (!memory) {
    await deletePairIndex(code);
    return { ok: false, error: "That code has expired or was already used.", status: 410 };
  }
  await deletePairIndex(code);
  return { ok: true, user_id: userId, token: formatDeviceToken(userId, secret), memory };
}
