import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceKind } from "./device";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

test("iPhone is ios, Android is android", () => {
  assert.equal(deviceKind({ userAgent: IPHONE, maxTouchPoints: 5 }), "ios");
  assert.equal(deviceKind({ userAgent: ANDROID, maxTouchPoints: 5 }), "android");
});

test("an iPad asking for the desktop site reports as a Mac but has touch", () => {
  assert.equal(deviceKind({ userAgent: MAC, maxTouchPoints: 5 }), "ios");
});

test("Mac and Windows desktops get neither phone wallet", () => {
  assert.equal(deviceKind({ userAgent: MAC, maxTouchPoints: 0 }), "desktop");
  assert.equal(deviceKind({ userAgent: WINDOWS }), "desktop");
});
