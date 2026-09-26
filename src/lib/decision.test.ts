import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decision, Offer, UserSettings } from "./types";
import { UserSettingsSchema } from "./types";
import { applyPremium, buildShortlistFromOffers, listingToItem } from "./decision";
import { FIXTURE_LISTINGS } from "./fixtures";
import { fallbackProductBrief } from "./judge/research";

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

test("shortlist keeps every listing including ads", () => {
  const junk = Array.from({ length: 15 }, (_, i) =>
    offer({
      section: "browse",
      title: `Black fleece jacket ${i}`,
      price: `£${10 + i}.00`,
      merchant: "Shop",
    }),
  );
  const ads = Array.from({ length: 6 }, (_, i) =>
    offer({
      section: "sponsored",
      title: `Sponsored TV ${i}`,
      price: `£${100 + i}.00`,
      merchant: "AdShop",
      offer_id: `ad-${i}`,
    }),
  );
  const tv = offer({
    section: "browse",
    title: "Samsung 85 inch Neo QLED N990F",
    price: "£2,499.00",
    merchant: "Currys",
    returns: "30-day returns",
    product_url: "https://www.currys.co.uk/tv",
  });
  const brief = fallbackProductBrief("samsung n990f 85 inch", []);
  const { items, all, deduped } = buildShortlistFromOffers([tv, ...junk, ...ads], brief);
  assert.equal(deduped, 0);
  assert.equal(all.length, 22);
  assert.equal(items.length, 22);
  assert.equal(items.filter((i) => i.section === "sponsored").length, 6);
  assert.ok(items.some((i) => /n990f/i.test(i.title)));
  assert.equal(items.find((i) => /n990f/i.test(i.title))?.product_url, "https://www.currys.co.uk/tv");
});

function settings(bps: number): UserSettings {
  return {
    protection_premium_bps: bps,
    protection_premium_pence: 1000,
    switch_minimum_pence: 800,
    approval: "ask",
  };
}

function decision(
  partial: Pick<Decision, "same_item" | "mislisting" | "seller_type" | "venue_trust">,
): Decision {
  return {
    photo_reason: partial.mislisting ? "photo contradicts the title" : null,
    sponsored: false,
    rights: [],
    recommendation: "buy",
    reason: "test",
    ...partial,
  };
}

const fleeceItems = FIXTURE_LISTINGS.map(listingToItem);
const fleeceDecisions: Record<string, Decision> = {
  "mislisting-22": decision({
    same_item: false,
    mislisting: true,
    seller_type: "unclear",
    venue_trust: "marketplace_unprotected",
  }),
  "private-28": decision({
    same_item: true,
    mislisting: false,
    seller_type: "private",
    venue_trust: "stranger",
  }),
  "shop-36": decision({
    same_item: true,
    mislisting: false,
    seller_type: "uk_business",
    venue_trust: "shop_checkout",
  }),
  "overseas-34": decision({
    same_item: true,
    mislisting: false,
    seller_type: "overseas_business",
    venue_trust: "marketplace_unprotected",
  }),
};

test("22% off the shop is inside 25% so the shop wins", () => {
  const verdict = applyPremium(fleeceItems, fleeceDecisions, settings(2500));
  assert.equal(verdict.chosen_id, "shop-36");
  assert.match(verdict.summary, /22% off the shop, inside your 25%/);
  assert.match(verdict.summary, /£8\.00, 22% of the shop/);
  assert.doesNotMatch(verdict.summary, /£10/);
});

test("22% off the shop is past 15% so the private listing wins", () => {
  const verdict = applyPremium(fleeceItems, fleeceDecisions, settings(1500));
  assert.equal(verdict.chosen_id, "private-28");
  assert.match(verdict.summary, /22% off, past your 15%/);
  assert.match(verdict.summary, /fault is your problem/);
  assert.doesNotMatch(verdict.summary, /£5\.00 inside/);
});

test("cheaper protected listing wins without a premium", () => {
  const items = fleeceItems.map((item) =>
    item.id === "shop-36" ? { ...item, price_pence: 2000, price_label: "£20.00" } : item,
  );
  const verdict = applyPremium(items, fleeceDecisions, settings(2500));
  assert.equal(verdict.chosen_id, "shop-36");
  assert.match(verdict.summary, /No premium needed/);
});

test("mislisting never reaches the percent comparison", () => {
  const atZero = applyPremium(fleeceItems, fleeceDecisions, settings(0));
  assert.notEqual(atZero.chosen_id, "mislisting-22");
  assert.equal(atZero.chosen_id, "private-28");

  const onlyMislisting = applyPremium(
    fleeceItems.filter((item) => item.id === "mislisting-22" || item.id === "shop-36"),
    fleeceDecisions,
    settings(0),
  );
  assert.equal(onlyMislisting.chosen_id, "shop-36");
  assert.match(onlyMislisting.summary, /dropped before price/);
});

test("old pence-only settings are ignored and default to 2500 bps", () => {
  const parsed = UserSettingsSchema.parse({
    protection_premium_pence: 500,
    switch_minimum_pence: 800,
    approval: "ask",
  });
  assert.equal(parsed.protection_premium_bps, 2500);
  assert.equal(parsed.protection_premium_pence, 500);
  const verdict = applyPremium(fleeceItems, fleeceDecisions, parsed);
  assert.equal(verdict.chosen_id, "shop-36");
});
