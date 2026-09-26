import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decision, Offer } from "./types";
import { isProtected, offerToItem } from "./decision";
import { applyRetailerWhitelist, isKnownUkRetailer, retailerKey } from "./uk-retailers";

function offer(merchant: string, index = 0): Offer {
  return {
    section: "browse",
    title: "Sony WH-1000XM5 headphones",
    price: "£279.00",
    price_pence: 27900,
    compare_at: null,
    merchant,
    badge: null,
    delivery: null,
    rating: null,
    rating_count: null,
    offer_id: `o${index}`,
  };
}

const unclear: Decision = {
  same_item: true,
  mislisting: false,
  photo_reason: null,
  sponsored: false,
  seller_type: "unclear",
  venue_trust: "unclear",
  rights: [],
  recommendation: "ask",
  reason: "Seller unclear.",
};

test("the big UK names match however the shop writes them", () => {
  for (const merchant of [
    "Sky",
    "Tesco",
    "Amazon.co.uk",
    "Amazon",
    "Currys",
    "Currys PC World",
    "John Lewis & Partners",
    "Sainsbury's",
    "Marks & Spencer",
    "AO.com",
    "B&Q",
    "Very.co.uk",
    "www.argos.co.uk",
    "Samsung UK",
    "The Entertainer",
  ]) {
    assert.equal(isKnownUkRetailer(merchant), true, merchant);
  }
});

test("third-party sellers, lookalikes and overseas storefronts stay with the judge", () => {
  for (const merchant of [
    "Amazon.co.uk - Seller",
    "Tesco Marketplace",
    "eBay · jess_k",
    "Facebook Marketplace · Tom K",
    "Next Day Gadgets Ltd",
    "Skyline Deals",
    "amazon.com",
    "Amazon.de",
    "XtremeSkins",
    "GlobalStyle Outlet",
  ]) {
    assert.equal(isKnownUkRetailer(merchant), false, merchant);
  }
  assert.equal(retailerKey("John Lewis & Partners Ltd"), "john lewis and partners");
});

test("an under-rated retailer becomes a protected UK business; nothing else changes", () => {
  const items = [offerToItem(offer("Tesco", 1), 1), offerToItem(offer("XtremeSkins", 2), 2)];
  const decisions = { [items[0].id]: unclear, [items[1].id]: unclear };
  const { decisions: next, promoted } = applyRetailerWhitelist(items, decisions);
  assert.deepEqual(promoted, ["Tesco"]);
  assert.equal(isProtected(next[items[0].id]), true);
  assert.deepEqual(next[items[0].id].rights, ["14-day cancellation (CCR 2013)", "30-day fault refund (CRA 2015)"]);
  assert.match(next[items[0].id].reason, /^Tesco is a known UK retailer/);
  assert.equal(next[items[1].id], unclear);
});

test("a mislisting from a whitelisted shop is still a mislisting, with the judge's reason", () => {
  const items = [offerToItem(offer("Argos", 1), 1)];
  const wrong: Decision = { ...unclear, same_item: false, mislisting: true, reason: "Photo shows a different model." };
  const { decisions: next } = applyRetailerWhitelist(items, { [items[0].id]: wrong });
  assert.equal(next[items[0].id].mislisting, true);
  assert.equal(next[items[0].id].same_item, false);
  assert.equal(next[items[0].id].reason, "Photo shows a different model.");
});

test("a retailer the judge already rated protected is left as it was", () => {
  const items = [offerToItem(offer("Currys", 1), 1)];
  const fine: Decision = { ...unclear, seller_type: "uk_business", venue_trust: "shop_checkout", reason: "Currys checkout." };
  const { decisions: next, promoted } = applyRetailerWhitelist(items, { [items[0].id]: fine });
  assert.equal(next[items[0].id], fine);
  assert.deepEqual(promoted, []);
});
