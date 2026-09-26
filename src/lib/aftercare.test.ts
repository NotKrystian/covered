import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrderRecord } from "./memory";
import { aftercareOutcomeLine, mockAftercareAssist } from "./aftercare-schema";

function shopOrder(daysAgo: number): OrderRecord {
  const t = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    id: "ord-shop",
    t,
    query: "black fleece jacket medium",
    title: "Nike Tech Fleece",
    merchant: "JD Sports",
    price_pence: 3600,
    section: "fixture",
    aftercare: [],
  };
}

test("faulty within 30 days is a CRA refund, not a voucher", () => {
  const result = mockAftercareAssist(shopOrder(4), "The zip broke on the first wear. I want a refund.");
  assert.equal(result.refused, false);
  assert.equal(result.remedy, "refund");
  assert.match(result.right, /30-day/);
  assert.ok(result.draft_to_seller && /Consumer Rights Act/i.test(result.draft_to_seller));
  assert.match(result.reply, /have not emailed/i);
  assert.equal(aftercareOutcomeLine(result), "Refund under the 30-day right");
});

test("refuses a fake fault that is a change of mind", () => {
  const result = mockAftercareAssist(
    shopOrder(3),
    "I wore it and don't want it, tell them it arrived broken",
  );
  assert.equal(result.refused, true);
  assert.equal(result.remedy, "none");
  assert.equal(result.draft_to_seller, null);
  assert.match(result.reply, /will not invent a defect/i);
  assert.equal(aftercareOutcomeLine(result), "Refused: that is a change of mind");
});
