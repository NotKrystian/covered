/**
 * Anonymous identity for preference memory — owned by Judge+Memory.
 *
 * No auth. A `covered_uid` cookie (httpOnly, one year) is read on every memory-aware
 * route and minted on first sight. The value is a random UUID and nothing else.
 */
import { cookies } from "next/headers";

export const UID_COOKIE = "covered_uid";
export const ONBOARDED_COOKIE = "covered_onboarded";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read the cookie without minting. Used by background limit polls so they never create users. */
export async function peekUserId(): Promise<string | null> {
  const store = await cookies();
  const existing = store.get(UID_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) return existing;
  return null;
}

/**
 * Return the caller's anonymous user id, minting and setting the cookie when absent.
 * Must be called from a Route Handler or Server Action (it may write a cookie).
 */
export async function getUserId(): Promise<{ userId: string; isNew: boolean }> {
  const store = await cookies();
  const existing = store.get(UID_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) return { userId: existing, isNew: false };
  const userId = crypto.randomUUID();
  store.set(UID_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return { userId, isNew: true };
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
