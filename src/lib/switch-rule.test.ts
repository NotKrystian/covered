import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decision, Offer } from "./types";
import type { OrderRecord } from "./memory";
import { offerToItem } from "./decision";
import {
  RETURN_POSTAGE_PENCE,
  coolingOffBlock,
  evaluateSwitch,
  isSwitchWatching,
  returnPostagePence,
  simulatedDropOffers,
  switchWindowEnds,
} from "./switch-rule";

const DAY = 86_400_000;

function order(partial: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    t: new Date("2026-09-26T12:00:00Z").toISOString(),
    query: "black fleece jacket medium",
    title: "Black Full-Zip Fleece Hoodie – Medium",
    merchant: "JD Sports",
    price_pence: 3600,
    section: "browse",
    aftercare: [],
    returns: "Free 14-day returns",
    seller_type: "uk_business",
    ...partial,
  };
}

function offer(title: string, pence: number, merchant: string): Offer {
  return {
    section: "browse",
    title,
    price: `£${(pence / 100).toFixed(2)}`,
    price_pence: pence,
    compare_at: null,
    merchant,
    badge: null,
    delivery: null,
    rating: null,
    rating_count: null,
  };
}

const protectedDecision: Decision = {
  same_item: true,
  mislisting: false,
  photo_reason: null,
  sponsored: false,
  seller_type: "uk_business",
  venue_trust: "shop_checkout",
  rights: ["14-day cancellation"],
  recommendation: "buy",
  reason: "UK shop",
};

const settings = { switch_minimum_pence: 800 };

test("the window is 14 days from purchase, and a cancelled order stops watching", () => {
  const o = order();
  assert.equal(switchWindowEnds(o).getTime() - new Date(o.t).getTime(), 14 * DAY);
  assert.equal(isSwitchWatching(o, new Date(new Date(o.t).getTime() + 13 * DAY)), true);
  assert.equal(isSwitchWatching(o, new Date(new Date(o.t).getTime() + 15 * DAY)), false);
  assert.equal(isSwitchWatching({ ...o, cancelled_at: o.t }, new Date(o.t)), false);
});

test("only an order from a UK business has a 14-day switch", () => {
  const o = order();
  const inside = new Date(new Date(o.t).getTime() + DAY);
  assert.equal(coolingOffBlock("uk_business"), null);
  assert.equal(isSwitchWatching(o, inside), true);
  assert.equal(isSwitchWatching({ ...o, seller_type: "private" }, inside), false);
  assert.match(coolingOffBlock("private") ?? "", /no 14-day right/);
  assert.equal(isSwitchWatching({ ...o, seller_type: "overseas_business" }, inside), false);
  assert.match(coolingOffBlock("overseas_business") ?? "", /hard to enforce/);
  assert.equal(isSwitchWatching({ ...o, seller_type: "unclear" }, inside), false);
  assert.equal(isSwitchWatching({ ...o, seller_type: undefined }, inside), false);
});

test("free returns cost nothing to send back; otherwise the postage estimate applies", () => {
  assert.equal(returnPostagePence({ returns: "Free 14-day returns" }), 0);
  assert.equal(returnPostagePence({ returns: "30-day returns" }), RETURN_POSTAGE_PENCE);
  assert.equal(returnPostagePence({ returns: null }), RETURN_POSTAGE_PENCE);
});

test("switches to the cheapest protected same item when it clears the minimum", () => {
  const items = [offer("fleece", 2400, "Next"), offer("fleece", 2600, "Argos")].map(offerToItem);
  const decisions = Object.fromEntries(items.map((i) => [i.id, protectedDecision]));
  const result = evaluateSwitch(order(), items, decisions, settings);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.item.merchant, "Next");
    assert.equal(result.postage_pence, 0);
    assert.equal(result.clear_pence, 1200);
  }
});

test("return postage counts against the saving", () => {
  const items = [offer("fleece", 2600, "Next")].map(offerToItem);
  const decisions = { [items[0].id]: protectedDecision };
  // £36 − £26 − £3.99 = £6.01, under the £8 minimum.
  const result = evaluateSwitch(order({ returns: "Returns in 30 days" }), items, decisions, settings);
  assert.equal(result.ok, false);
  assert.match(result.note, /clear £6\.01 after £3\.99 return postage, under your £8\.00/);
});

test("never switches to a private seller, a mislisting, or a different item, however cheap", () => {
  const items = [offer("fleece", 1000, "Tom K"), offer("fleece", 1100, "dealz"), offer("bomber", 1200, "Next")].map(
    offerToItem,
  );
  const decisions: Record<string, Decision> = {
    [items[0].id]: { ...protectedDecision, seller_type: "private", venue_trust: "stranger" },
    [items[1].id]: { ...protectedDecision, mislisting: true, same_item: false },
    [items[2].id]: { ...protectedDecision, same_item: false },
  };
  const result = evaluateSwitch(order(), items, decisions, settings);
  assert.equal(result.ok, false);
  assert.equal(result.note, "no cheaper listing from a UK business");
});

test("the demo simulation is the same listing 35% cheaper, labelled as a price drop", () => {
  const [sim] = simulatedDropOffers(order());
  assert.equal(sim?.price_pence, 2340);
  assert.equal(sim?.title, order().title);
  assert.equal(sim?.badge, "Price drop");
});
