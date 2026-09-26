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
