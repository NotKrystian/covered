import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyOfferPrice, normalizeOfferPrice } from "./price-kind";
import type { Offer } from "./types";

function offer(partial: Partial<Offer> & Pick<Offer, "price" | "title">): Offer {
  return {
    section: "browse",
    merchant: "EE",
    compare_at: null,
    badge: null,
    delivery: null,
    rating: null,
    rating_count: null,
    ...partial,
  };
}

test("£30/month plus iPhone 24 months is monthly, not a £30 handset", () => {
  const classified = classifyOfferPrice({
    price: "£30/month",
    title: "iPhone 24 months",
  });
  assert.equal(classified.price_kind, "monthly");
  assert.equal(classified.price_pence, null);
  assert.equal(classified.monthly_pence, 3000);
  assert.equal(classified.term_months, 24);
});

test("£899 cash phone stays cash", () => {
  const classified = classifyOfferPrice({
    price: "£899",
    title: "iPhone 16 128GB",
  });
  assert.equal(classified.price_kind, "cash");
  assert.equal(classified.price_pence, 89900);
  assert.equal(classified.monthly_pence, null);
});

test("£899 or £30/month keeps cash and fills monthly fields", () => {
  const classified = classifyOfferPrice({
    price: "£899 or £30/month",
    title: "iPhone 16 24 months",
  });
  assert.equal(classified.price_kind, "cash");
  assert.equal(classified.price_pence, 89900);
  assert.equal(classified.monthly_pence, 3000);
  assert.equal(classified.term_months, 24);
});

test("old payloads without price_kind are classified from title and price text", () => {
  const raw = offer({
    title: "iPhone 16 pay monthly 24 months",
    price: "£30/mo",
  });
  const normalized = normalizeOfferPrice(raw);
  assert.equal(normalized.price_kind, "monthly");
  assert.equal(normalized.price_pence, null);
  assert.equal(normalized.monthly_pence, 3000);
  assert.equal(normalized.term_months, 24);
});

test("from £29 upfront is not the cash/handset price", () => {
  const classified = classifyOfferPrice({
    price: "£30/month",
    title: "Pixel 9 from £29 upfront 24 months",
  });
  assert.equal(classified.price_kind, "monthly");
  assert.equal(classified.price_pence, null);
  assert.equal(classified.monthly_pence, 3000);
  assert.equal(classified.upfront_pence, 2900);
  assert.equal(classified.term_months, 24);
});
