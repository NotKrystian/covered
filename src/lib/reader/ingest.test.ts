import assert from "node:assert/strict";
import { test } from "node:test";
import type { Offer } from "../types";
import { BROWSER_READ_NOTE, ingestClientOffers } from "./ingest";

function offer(partial: Partial<Offer> & Pick<Offer, "section" | "title" | "price" | "merchant">): Offer {
  return {
    compare_at: null,
    badge: null,
    delivery: null,
    rating: null,
    rating_count: null,
    ...partial,
  };
}

test("ingestClientOffers marks a live browser read and parses pence", () => {
  const result = ingestClientOffers("samsung n990f 85 inch tv", [
    offer({
      section: "browse",
      title: "Samsung N990F 85\"",
      price: "£1,299.00",
      merchant: "Currys",
      returns: "30-day returns",
    }),
  ]);
  assert.equal(result.source, "live");
  assert.equal(result.note, BROWSER_READ_NOTE);
  assert.equal(result.query, "samsung n990f 85 inch tv");
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0]?.price_pence, 129900);
});

test("ingestClientOffers classifies a monthly payload that omitted price_kind", () => {
  const result = ingestClientOffers("iphone 16", [
    offer({
      section: "browse",
      title: "iPhone 16 24 months",
      price: "£30/month",
      merchant: "EE",
    }),
  ]);
  assert.equal(result.offers[0]?.price_kind, "monthly");
  assert.equal(result.offers[0]?.price_pence, null);
  assert.equal(result.offers[0]?.monthly_pence, 3000);
  assert.equal(result.offers[0]?.term_months, 24);
});

test("ingestClientOffers drops duplicate browse rows", () => {
  const row = offer({
    section: "browse",
    title: "Same TV",
    price: "£100.00",
    merchant: "Shop",
  });
  const result = ingestClientOffers("tv", [row, { ...row }]);
  assert.equal(result.offers.length, 1);
});
