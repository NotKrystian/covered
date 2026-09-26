/**
 * Which phone wallet this device can offer: Apple Pay on iPhone and iPad, Google Pay
 * on Android, neither on a desktop (Mac included). Pure, so it can be tested with
 * made-up user agents; pass `navigator` in the browser.
 */
export type DeviceKind = "ios" | "android" | "desktop";

export type NavigatorLike = { userAgent: string; maxTouchPoints?: number };

export function deviceKind(nav: NavigatorLike): DeviceKind {
  const ua = nav.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS asks for the desktop site and reports as a Mac; only the iPad has a touch screen.
  if (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return "ios";
  return "desktop";
}
