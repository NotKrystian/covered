import assert from "node:assert/strict";
import { test } from "node:test";
import type { OrderRecord } from "./memory";
import { returnEmail, returnNote, returnState, returnStatus } from "./returns";

const DAY = 86_400_000;
const T0 = new Date("2026-09-26T12:00:00Z").getTime();

function order(partial: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    t: new Date(T0).toISOString(),
    query: "black fleece jacket medium",
    title: "Black Full-Zip Fleece Hoodie – Medium",
    merchant: "JD Sports",
    price_pence: 3600,
    section: "browse",
    aftercare: [],
    returns: "Free 14-day returns",
    ...partial,
  };
}

test("inside 14 days a UK shop order can be returned; free returns mean a full refund", () => {
  const state = returnState(order(), T0 + 3 * DAY);
  assert.equal(state.kind, "open");
  if (state.kind !== "open") return;
  const ret = state.options.find((o) => o.kind === "return");
  assert.equal(ret?.refund_pence, 3600);
  assert.equal(ret?.postage_pence, 0);
  assert.deepEqual(state.options.map((o) => o.kind), ["return", "fault_refund", "replace", "repair"]);
});

test("without free returns the postage estimate comes off a change-of-mind refund, not a fault refund", () => {
  const state = returnState(order({ returns: "30-day returns" }), T0 + DAY);
  if (state.kind !== "open") throw new Error("expected open");
  assert.equal(state.options.find((o) => o.kind === "return")?.refund_pence, 3600 - 399);
  assert.equal(state.options.find((o) => o.kind === "fault_refund")?.refund_pence, 3600);
});

test("after 14 days only fault remedies remain; after 30 days no fault refund", () => {
  const day20 = returnState(order(), T0 + 20 * DAY);
  if (day20.kind !== "open") throw new Error("expected open");
  assert.deepEqual(day20.options.map((o) => o.kind), ["fault_refund", "replace", "repair"]);
  assert.match(day20.note ?? "", /14-day change-of-mind window has closed/);
  const day40 = returnState(order(), T0 + 40 * DAY);
  if (day40.kind !== "open") throw new Error("expected open");
  assert.deepEqual(day40.options.map((o) => o.kind), ["replace", "repair"]);
});

test("a private seller gets no statutory options", () => {
  const state = returnState(order({ merchant: "Facebook Marketplace · Tom K" }), T0 + DAY);
  assert.equal(state.kind, "private");
});

test("an order the judge rated private gets no options even when the merchant name does not say so", () => {
  const state = returnState(order({ merchant: "eBay · jess_k", seller_type: "private" }), T0 + DAY);
  assert.equal(state.kind, "private");
  assert.match(state.kind === "private" ? state.note : "", /^eBay · jess_k is a private seller/);
});

test("returned and switched orders are done; requests show as a status", () => {
  assert.equal(returnState(order({ cancelled_at: new Date(T0).toISOString(), refund_pence: 3600 }), T0).kind, "done");
  assert.equal(returnStatus(order({ cancelled_at: "x", switched_to: "o2" })), "switched");
  const requested = order({
    aftercare: [{ t: "x", remedy: "replace", refused: false, note: returnNote(order(), { kind: "replace", label: "", right: "", refund_pence: null, postage_pence: 0 }) }],
  });
  assert.equal(returnStatus(requested), "replacement requested");
});

test("the return email cancels under the 14-day right, asks for a free label, and signs with the buyer's name", () => {
  const email = returnEmail(order(), "return", "Alan");
  assert.equal(email.to, "JD Sports customer service");
  assert.match(email.subject, /^Cancelling my order: Black Full-Zip Fleece Hoodie/);
  assert.match(email.body, /^Hello JD Sports,/);
  assert.match(email.body, /Consumer Contracts Regulations 2013/);
  assert.match(email.body, /prepaid returns label/);
  assert.match(email.body, /Thanks,\nAlan$/);
  assert.doesNotMatch(returnEmail(order({ returns: "30-day returns" }), "return").body, /prepaid returns label/);
});

test("a switch sends the same plain cancellation; fault emails cite the Consumer Rights Act", () => {
  const cancel = returnEmail(order(), "switch").body;
  assert.equal(cancel, returnEmail(order(), "return").body);
  assert.doesNotMatch(cancel, /cheaper|price drop/i);
  assert.match(returnEmail(order(), "fault_refund").body, /rejecting it within 30 days/);
  assert.match(returnEmail(order(), "replace").subject, /^Faulty item: please replace it/);
  assert.match(returnEmail(order(), "repair").body, /Consumer Rights Act 2015/);
});
