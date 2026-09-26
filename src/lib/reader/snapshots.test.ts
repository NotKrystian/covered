import assert from "node:assert/strict";
import { test } from "node:test";
import { findSnapshot, slugify } from "./snapshots";

test("slugify matches the saved fleece snapshot name", () => {
  assert.equal(slugify("black fleece jacket medium"), "black-fleece-jacket-medium");
});

test("findSnapshot returns only an exact slug match", async () => {
  const exact = await findSnapshot("black fleece jacket medium");
  assert.ok(exact);
  assert.equal(exact.exact, true);
  assert.equal(exact.slug, "black-fleece-jacket-medium");

  const tv = await findSnapshot("samsung n990f 85 inch tv");
  assert.equal(tv, null, "must not fall back to samsung-50-inch-tv via shared words");
});
