/**
 * Anonymous identity for preference memory — owned by Judge+Memory.
 *
 * No accounts. A `covered_uid` cookie (httpOnly, one year) is read on every memory-aware
 * route and minted on first sight. The value is a random UUID and nothing else.
 *
 * Second device: a client that cannot hold cookies (the iPhone app) sends
 * `Authorization: Bearer <token>` instead. Tokens are minted by POST /api/pair/claim and
 * stored hashed on the memory item (`device_tokens[]`). The token is `<user_id>.<secret>`
 * so the server can load the one item and compare hashes; no scan, no index.
 *
 * `resolveUser(request)` is the single entry point every route should use.
 */
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getMemory } from "@/lib/memory";

export const UID_COOKIE = "covered_uid";
export const ONBOARDED_COOKIE = "covered_onboarded";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_SECRET_RE = /^[A-Za-z0-9_-]{40,50}$/;

/** How the caller was identified. `minted` means no cookie or token was present and a new id was set. */
export type IdentityVia = "cookie" | "token" | "minted";

export type ResolvedUser = { userId: string; isNew: boolean; via: IdentityVia };

/**
 * Thrown when an `Authorization: Bearer` header is present but does not match a live
 * device token. Routes answer 401 so a phone knows to pair again instead of silently
 * becoming a new anonymous user. Use `unauthorizedResponse(err)` in the catch.
 */
export class InvalidDeviceTokenError extends Error {
  readonly status = 401;
  constructor(message = "invalid_token") {
    super(message);
    this.name = "InvalidDeviceTokenError";
  }
}

/** `NextResponse` 401 for an `InvalidDeviceTokenError`, or null so the caller can rethrow anything else. */
export function unauthorizedResponse(err: unknown): NextResponse<{ ok: false; error: string }> | null {
  if (!(err instanceof InvalidDeviceTokenError)) return null;
  return NextResponse.json({ ok: false, error: "invalid_token: pair this device again" }, { status: 401 });
}

/** sha256 hex of a device-token secret. Only the hash is ever stored. */
export function hashTokenSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Split `<user_id>.<secret>`; null when the shape is wrong. */
export function parseDeviceToken(token: string): { userId: string; secret: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const userId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(userId) || !TOKEN_SECRET_RE.test(secret)) return null;
  return { userId, secret };
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

async function authorizationHeader(request?: Request): Promise<string | null> {
  if (request) return request.headers.get("authorization");
  try {
    const list = await headers();
    return list.get("authorization");
  } catch {
    return null;
  }
}

/**
 * Resolve a bearer token to a user id. Null when no Bearer header is present.
 * Throws `InvalidDeviceTokenError` when one is present but malformed, unknown or revoked.
 * Loads the memory item named in the token and compares the stored hashes.
 */
export async function userIdFromBearer(request?: Request): Promise<string | null> {
  const header = await authorizationHeader(request);
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const parsed = parseDeviceToken(match[1]!.trim());
  if (!parsed) throw new InvalidDeviceTokenError("malformed token");
  const memory = await getMemory(parsed.userId);
  const hash = hashTokenSecret(parsed.secret);
  const found = (memory.device_tokens ?? []).some((t) => constantTimeEqualHex(t.hash, hash));
  if (!found) throw new InvalidDeviceTokenError("unknown or revoked token");
  return parsed.userId;
}

async function cookieUserId(): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(UID_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) return existing;
  return null;
}

/**
 * Identify the caller without minting: bearer token first, then the cookie.
 * Used by background polls (limits, reader jobs) so they never create users.
 * Throws `InvalidDeviceTokenError` for a present-but-bad Bearer header.
 */
export async function peekUser(request?: Request): Promise<ResolvedUser | null> {
  const viaToken = await userIdFromBearer(request);
  if (viaToken) return { userId: viaToken, isNew: false, via: "token" };
  const viaCookie = await cookieUserId();
  if (viaCookie) return { userId: viaCookie, isNew: false, via: "cookie" };
  return null;
}

/**
 * Identify the caller, minting a `covered_uid` cookie when neither a bearer token nor a
 * cookie is present. Must be called from a Route Handler or Server Action (it may write a cookie).
 * Throws `InvalidDeviceTokenError` for a present-but-bad Bearer header; answer with
 * `unauthorizedResponse(err)`.
 */
export async function resolveUser(request?: Request): Promise<ResolvedUser> {
  const peeked = await peekUser(request);
  if (peeked) return peeked;
  const userId = crypto.randomUUID();
  await setUserCookie(userId);
  return { userId, isNew: true, via: "minted" };
}

/** A ready-made 401 for a bad device token. */
export type Denied = NextResponse<{ ok: false; error: string }>;

export function isDenied(value: unknown): value is Denied {
  return value instanceof NextResponse;
}

/** `resolveUser`, but a bad Bearer header comes back as a 401 response instead of a throw. */
export async function resolveUserOr401(request?: Request): Promise<ResolvedUser | Denied> {
  try {
    return await resolveUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
}

/** `peekUser`, but a bad Bearer header comes back as a 401 response instead of a throw. */
export async function peekUserOr401(request?: Request): Promise<ResolvedUser | null | Denied> {
  try {
    return await peekUser(request);
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    throw err;
  }
}

/** Write the identity cookie. Also used by /api/pair/claim to move this browser onto the paired user. */
export async function setUserCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(UID_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

/** Read the identity without minting. Kept for callers that predate `peekUser`. */
export async function peekUserId(): Promise<string | null> {
  const peeked = await peekUser();
  return peeked?.userId ?? null;
}

/** Return the caller's user id, minting when absent. Kept for callers that predate `resolveUser`. */
export async function getUserId(): Promise<{ userId: string; isNew: boolean }> {
  const resolved = await resolveUser();
  return { userId: resolved.userId, isNew: resolved.isNew };
}

/** Drop the cookie so the next request starts a fresh identity ("Reset memory"). */
export async function clearUserId(): Promise<void> {
  const store = await cookies();
  store.delete(UID_COOKIE);
  store.delete(ONBOARDED_COOKIE);
}

export async function setOnboardedCookie(): Promise<void> {
  const store = await cookies();
  store.set(ONBOARDED_COOKIE, "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}
