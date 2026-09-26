import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decision } from "./types";
import { listingToItem } from "./decision";
import { FIXTURE_LISTINGS } from "./fixtures";
import { protectedAlternative } from "./protected-pick";

const base: Decision = {
  same_item: true,
  mislisting: false,
  photo_reason: null,
  sponsored: false,
  seller_type: "uk_business",
  venue_trust: "shop_checkout",
  rights: ["14-day cancellation (CCR 2013)", "30-day fault refund (CRA 2015)"],
  recommendation: "buy",
  reason: "",
};

const listings = FIXTURE_LISTINGS.map(listingToItem);
const decisions: Record<string, Decision> = {
  "mislisting-22": { ...base, same_item: false, mislisting: true, seller_type: "unclear", venue_trust: "marketplace_unprotected" },
  "private-28": { ...base, seller_type: "private", venue_trust: "stranger", rights: [] },
  "overseas-34": { ...base, seller_type: "overseas_business", venue_trust: "marketplace_unprotected", rights: [] },
  "shop-36": base,
};

function verdict(chosen_id: string | null) {
  return { chosen_id, per_offer: decisions, summary: "" };
}

test("a private pick offers the cheapest UK shop instead, and says how much more it costs", () => {
  const alt = protectedAlternative({ listings, decisions, verdict: verdict("private-28") });
  assert.equal(alt?.item.merchant, "JD Sports");
  assert.equal(alt?.item.price_pence, 3600);
  assert.equal(alt?.extra_pence, 800);
});

test("the cheaper overseas listing and the mislisting are never the UK option", () => {
  const alt = protectedAlternative({ listings, decisions, verdict: verdict("overseas-34") });
  assert.equal(alt?.item.id, "shop-36");
});

test("no option when the pick already keeps your rights, or when no UK seller has the item", () => {
  assert.equal(protectedAlternative({ listings, decisions, verdict: verdict("shop-36") }), null);
  assert.equal(protectedAlternative({ listings, decisions, verdict: verdict(null) }), null);
  const noShop = { ...decisions, "shop-36": { ...base, same_item: false } };
  assert.equal(protectedAlternative({ listings, decisions: noShop, verdict: verdict("private-28") }), null);
});
