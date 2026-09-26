import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decision } from "./types";
import type { ShortlistItem } from "./decision";
import {
  listingBrand,
  protectionRank,
  shippingPence,
  pinChosen,
  sortListings,
} from "./sort-listings";

function item(partial: Partial<ShortlistItem> & Pick<ShortlistItem, "id" | "title">): ShortlistItem {
  return {
    price_pence: 1000,
    price_label: "£10.00",
    price_kind: "cash",
    merchant: "Shop",
    delivery: null,
    returns: null,
    rating: null,
    rating_count: null,
    section: "browse",
    badge: null,
    image_urls: [],
    raw: {
      kind: "listing",
      listing: {
        id: partial.id,
        title: partial.title,
        price_pence: partial.price_pence ?? 1000,
        merchant: partial.merchant ?? "Shop",
        venue: "Shop",
        image_urls: [],
        returns_text: "",
        delivery_text: "",
      },
    },
    ...partial,
  };
}

function decision(partial: Partial<Decision>): Decision {
  return {
    same_item: true,
    mislisting: false,
    photo_reason: null,
    sponsored: false,
    seller_type: "unclear",
    venue_trust: "unclear",
    rights: [],
    recommendation: "ask",
    reason: "test",
    ...partial,
  };
}

test("listingBrand prefers the research brand when the title starts with it", () => {
  const nike = item({ id: "n", title: "Nike Tech Fleece Full-Zip Hoodie Black M", merchant: "dealz" });
  assert.equal(listingBrand(nike, "Nike"), "Nike");
  assert.equal(listingBrand(nike, "NIKE"), "NIKE");
  assert.equal(listingBrand(nike, "Adidas"), "Nike");
});

test("listingBrand skips The, then first token, else merchant", () => {
  assert.equal(listingBrand(item({ id: "a", title: "The North Face fleece", merchant: "Cotswold" }), ""), "North");
  assert.equal(listingBrand(item({ id: "b", title: "Black fleece zip", merchant: "JD Sports" }), ""), "Black");
  assert.equal(listingBrand(item({ id: "c", title: "   ", merchant: "Argos" }), ""), "Argos");
});

test("shippingPence parses free, pounds, collection, and unknown", () => {
  assert.equal(shippingPence("Free delivery, 2–3 days"), 0);
  assert.equal(shippingPence("FREE"), 0);
  assert.equal(shippingPence("£3.99 delivery, 5–7 days"), 399);
  assert.equal(shippingPence("Delivery from £4.50"), 450);
  assert.equal(shippingPence("Collection only"), 0);
  assert.equal(shippingPence("Click and collect"), 0);
  assert.equal(shippingPence("Click & collect in store"), 0);
  assert.equal(shippingPence("Ships from overseas, 12–20 days"), null);
  assert.equal(shippingPence(""), null);
  assert.equal(shippingPence(null), null);
});

test("protectionRank uses the decision, not sponsored, and text as fallback", () => {
  const shop = item({
    id: "shop",
    title: "Fleece",
    returns: "Free 14-day returns",
    section: "sponsored",
  });
  const marketplace = item({ id: "mkt", title: "Fleece" });
  const overseas = item({ id: "os", title: "Fleece", delivery: "Ships from overseas" });
  const privateSeller = item({ id: "priv", title: "Fleece", merchant: "Facebook Marketplace · Tom" });
  const unclear = item({ id: "u", title: "Fleece" });

  assert.equal(
    protectionRank(shop, decision({ seller_type: "uk_business", venue_trust: "shop_checkout" })),
    0,
  );
  assert.equal(
    protectionRank(
      item({ id: "uk-mkt", title: "Fleece", returns: "No returns" }),
      decision({ seller_type: "uk_business", venue_trust: "marketplace_unprotected" }),
    ),
    1,
  );
  assert.equal(
    protectionRank(marketplace, decision({ seller_type: "private", venue_trust: "marketplace_protected" })),
    1,
  );
  assert.equal(
    protectionRank(overseas, decision({ seller_type: "overseas_business", venue_trust: "marketplace_unprotected" })),
    2,
  );
  assert.equal(
    protectionRank(privateSeller, decision({ seller_type: "private", venue_trust: "stranger" })),
    3,
  );
  assert.equal(protectionRank(unclear, decision({ seller_type: "unclear", venue_trust: "unclear" })), 4);
  assert.equal(protectionRank(unclear, undefined), 4);
  assert.equal(protectionRank(shop, undefined), 0);
  assert.equal(protectionRank(overseas, undefined), 2);
  assert.equal(protectionRank(privateSeller, undefined), 3);
});

test("sortListings: price missing last, brand and shipping tiebreak on price", () => {
  const cheap = item({ id: "cheap", title: "Nike fleece", price_pence: 1000, merchant: "A" });
  const dear = item({ id: "dear", title: "Nike hoodie", price_pence: 3000, merchant: "B" });
  const mid = item({ id: "mid", title: "Adidas fleece", price_pence: 2000, merchant: "C" });
  const unknown = item({ id: "unk", title: "Puma fleece", price_pence: null, merchant: "D" });

  assert.deepEqual(
    sortListings([dear, unknown, cheap, mid], "price_asc").map((i) => i.id),
    ["cheap", "mid", "dear", "unk"],
  );
  assert.deepEqual(
    sortListings([cheap, unknown, dear, mid], "price_desc").map((i) => i.id),
    ["dear", "mid", "cheap", "unk"],
  );
  assert.deepEqual(
    sortListings([dear, mid, cheap], "brand", {}, "Nike").map((i) => i.id),
    ["mid", "cheap", "dear"],
  );
});

test("sortListings: shipping unknown last, protections strongest first", () => {
  const free = item({ id: "free", title: "A", price_pence: 3600, delivery: "Free delivery" });
  const paid = item({ id: "paid", title: "B", price_pence: 2200, delivery: "£3.99 delivery" });
  const collect = item({ id: "collect", title: "C", price_pence: 2800, delivery: "Collection only" });
  const unknown = item({ id: "unk", title: "D", price_pence: 1000, delivery: "Ships from overseas" });

  assert.deepEqual(
    sortListings([unknown, paid, free, collect], "shipping").map((i) => i.id),
    ["collect", "free", "paid", "unk"],
  );

  const decisions: Record<string, Decision> = {
    free: decision({ seller_type: "uk_business", venue_trust: "shop_checkout" }),
    paid: decision({ seller_type: "private", venue_trust: "stranger" }),
    collect: decision({ seller_type: "overseas_business", venue_trust: "unclear" }),
    unk: decision({ seller_type: "unclear", venue_trust: "unclear" }),
  };
  assert.deepEqual(
    sortListings([unknown, paid, collect, free], "protections", decisions).map((i) => i.id),
    ["free", "collect", "paid", "unk"],
  );
});

test("sortListings: monthly-only rows sort after cash and never pin as the cash winner", () => {
  const cashDear = item({ id: "cash-dear", title: "iPhone cash", price_pence: 89900, price_kind: "cash" });
  const cashCheap = item({ id: "cash-cheap", title: "iPhone used", price_pence: 64900, price_kind: "cash" });
  const monthlyCheap = item({
    id: "mo-30",
    title: "iPhone 24 months",
    price_pence: null,
    price_kind: "monthly",
    monthly_pence: 3000,
    price_label: "£30/mo",
  });
  const monthlyDear = item({
    id: "mo-45",
    title: "iPhone 24 months EE",
    price_pence: null,
    price_kind: "monthly",
    monthly_pence: 4500,
    price_label: "£45/mo",
  });

  assert.deepEqual(
    sortListings([monthlyCheap, cashDear, monthlyDear, cashCheap], "price_asc").map((i) => i.id),
    ["cash-cheap", "cash-dear", "mo-30", "mo-45"],
  );
  assert.deepEqual(
    sortListings([monthlyCheap, cashDear, monthlyDear, cashCheap], "price_desc").map((i) => i.id),
    ["cash-dear", "cash-cheap", "mo-45", "mo-30"],
  );
  assert.deepEqual(
    sortListings([monthlyCheap, cashDear, cashCheap], "price_asc", {}, "", "mo-30").map((i) => i.id),
    ["cash-cheap", "cash-dear", "mo-30"],
  );
});

test("sortListings pins chosen_id first; the rest keep the sort", () => {
  const cheap = item({ id: "cheap", title: "A", price_pence: 1000 });
  const mid = item({ id: "mid", title: "B", price_pence: 2000 });
  const dear = item({ id: "dear", title: "C", price_pence: 3000 });

  assert.deepEqual(
    sortListings([dear, mid, cheap], "price_asc", {}, "", "dear").map((i) => i.id),
    ["dear", "cheap", "mid"],
  );
  assert.deepEqual(
    sortListings([cheap, mid, dear], "price_desc", {}, "", "cheap").map((i) => i.id),
    ["cheap", "dear", "mid"],
  );
  assert.deepEqual(
    sortListings([dear, mid, cheap], "price_asc").map((i) => i.id),
    ["cheap", "mid", "dear"],
  );
  assert.deepEqual(
    pinChosen([cheap, mid, dear], null).map((i) => i.id),
    ["cheap", "mid", "dear"],
  );
});
