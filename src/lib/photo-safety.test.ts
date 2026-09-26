import assert from "node:assert/strict";
import { test } from "node:test";
import { OfferSchema } from "./types";
import { IMAGE_DATA_URL_MAX, isGoogleImageUrl, safeImageDataUrl, safeImageUrl, sniffImageFormat } from "./photo-safety";

const JPEG_DATA_URL = `data:image/jpeg;base64,${"A".repeat(400)}`;
const TBN = "https://encrypted-tbn0.gstatic.com/shopping?q=tbn:ANd9GcQ";

test("safeImageDataUrl keeps bounded base64 rasters and drops the rest", () => {
  assert.equal(safeImageDataUrl(JPEG_DATA_URL), JPEG_DATA_URL);
  for (const bad of [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", // SVG can carry script
    "data:text/html;base64,PGgxPmhpPC9oMT4=",
    "data:image/jpeg,not-base64",
    `data:image/jpeg;base64,${"A".repeat(IMAGE_DATA_URL_MAX)}`, // oversize
    42,
    null,
  ]) {
    assert.equal(safeImageDataUrl(bad), null, String(bad).slice(0, 50));
  }
});

test("safeImageUrl keeps plain https only", () => {
  assert.equal(safeImageUrl(TBN), TBN);
  assert.equal(safeImageUrl("https://cdn.shop.co.uk/fleece.jpg"), "https://cdn.shop.co.uk/fleece.jpg");
  for (const bad of [
    "http://encrypted-tbn0.gstatic.com/x",
    "javascript:alert(1)",
    "https://user:pw@encrypted-tbn0.gstatic.com/x",
    "https://encrypted-tbn0.gstatic.com:8443/x",
    "/fixtures/fleece-black.jpg",
  ]) {
    assert.equal(safeImageUrl(bad), null, bad);
  }
});

test("isGoogleImageUrl gates what the server will fetch", () => {
  assert.equal(isGoogleImageUrl(TBN), true);
  assert.equal(isGoogleImageUrl("https://lh3.googleusercontent.com/abc=w200"), true);
  for (const bad of [
    "https://cdn.shop.co.uk/fleece.jpg", // fine to show, not to fetch server-side
    "https://gstatic.com.evil.example/x", // lookalike
    "https://169.254.169.254/latest/meta-data", // cloud metadata endpoint
    "http://encrypted-tbn0.gstatic.com/x",
  ]) {
    assert.equal(isGoogleImageUrl(bad), false, bad);
  }
});

test("OfferSchema nulls unsafe photos instead of rejecting the offer", () => {
  const base = {
    section: "browse",
    title: "Black fleece",
    price: "£20.00",
    compare_at: null,
    merchant: "Shop",
    badge: null,
    delivery: null,
    rating: null,
    rating_count: null,
  };
  const bad = OfferSchema.parse({ ...base, image_url: "javascript:alert(1)", image_data_url: "data:text/html;base64,PGgx" });
  assert.equal(bad.image_url, null);
  assert.equal(bad.image_data_url, null);
  const good = OfferSchema.parse({ ...base, image_url: TBN, image_data_url: JPEG_DATA_URL });
  assert.equal(good.image_url, TBN);
  assert.equal(good.image_data_url, JPEG_DATA_URL);
});

test("sniffImageFormat trusts magic bytes, not labels", () => {
  const ascii = (s: string) => new TextEncoder().encode(s);
  assert.equal(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(sniffImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "png");
  assert.equal(sniffImageFormat(ascii("GIF89a")), "gif");
  assert.equal(sniffImageFormat(ascii("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(sniffImageFormat(ascii("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
});
