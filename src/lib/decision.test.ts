import assert from "node:assert/strict";
import { test } from "node:test";
import type { Offer } from "./types";
import { buildShortlistFromOffers } from "./decision";
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

test("shortlist keeps every listing and sends the matching TV to the judge", () => {
  const junk = Array.from({ length: 15 }, (_, i) =>
    offer({
      section: "browse",
      title: `Black fleece jacket ${i}`,
      price: `£${10 + i}.00`,
      merchant: "Shop",
    }),
  );
  const tv = offer({
    section: "browse",
    title: "Samsung 85 inch Neo QLED N990F",
    price: "£2,499.00",
    merchant: "Currys",
    returns: "30-day returns",
  });
  const brief = fallbackProductBrief("samsung n990f 85 inch", []);
  const { items, all, deduped } = buildShortlistFromOffers([tv, ...junk], brief);
  assert.equal(deduped, 0);
  assert.equal(all.length, 16);
  assert.equal(items.length, 12);
  assert.ok(items.some((i) => /n990f/i.test(i.title)));
  assert.ok(all.some((i) => /n990f/i.test(i.title)));
});
