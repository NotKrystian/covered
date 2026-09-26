import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fallbackProductBrief,
  identityFromBrief,
  scoreAgainstBrief,
  type Snippet,
} from "./research";

const QUERY = "samsung n990f 85 inch";

test("fallback brief treats samsung n990f 85 inch as a TV from the query alone", () => {
  const brief = fallbackProductBrief(QUERY, []);
  assert.equal(brief.confidence, "low");
  assert.match(brief.category, /tele/i);
  assert.ok(brief.model_codes.some((c) => /n990f/i.test(c)));
  assert.ok(brief.must_match.some((t) => /85/.test(t)));
  assert.ok(brief.must_not_be.includes("case"));
  assert.ok(brief.must_not_be.includes("phone"));
});

test("fallback brief uses snippets when they mention Neo QLED", () => {
  const snippets: Snippet[] = [
    {
      title: "Samsung 85-inch Neo QLED 8K QN990F",
      text: "The Samsung QN990F Neo QLED is an 85 inch 8K television, not a phone.",
    },
  ];
  const brief = fallbackProductBrief(QUERY, snippets);
  assert.ok(brief.confidence !== "low");
  assert.ok(brief.must_match.some((t) => /neo qled/i.test(t)));
  assert.match(brief.what_it_is, /TV|television/i);
});

test("identity: 85 inch Neo QLED is the item; case and 75 inch are not", () => {
  const brief = fallbackProductBrief(QUERY, []);
  const tv = identityFromBrief("Samsung 85 inch Neo QLED N990F", brief);
  const phoneCase = identityFromBrief("Samsung Galaxy S25 Ultra phone case", brief);
  const smaller = identityFromBrief("Samsung 75 inch QLED TV", brief);
  assert.equal(tv.same_item, true);
  assert.equal(phoneCase.same_item, false);
  assert.equal(smaller.same_item, false);
});

test("lexical score ranks the 85 inch TV above accessories", () => {
  const brief = fallbackProductBrief(QUERY, []);
  const tv = scoreAgainstBrief("Samsung 85 inch Neo QLED N990F", brief);
  const phoneCase = scoreAgainstBrief("Samsung Galaxy phone case", brief);
  const fleece = scoreAgainstBrief("Black fleece jacket medium", brief);
  assert.ok(tv > phoneCase);
  assert.ok(tv > fleece);
});
