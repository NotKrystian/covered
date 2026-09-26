/**
 * Fixture listings — owned by the Decision+UI agent.
 *
 * Four seeded `Listing`s for one query, used when the grid is a challenge page
 * and for the wrong-jacket mislisting beat (right title, photo of a different jacket).
 * Photos live in `public/fixtures/` and are generated product shots, not brand images.
 */
import type { Listing } from "@/lib/types";

export type { Listing } from "@/lib/types";

export const FIXTURE_QUERY = "black fleece jacket medium";

/** Fixtures are the black fleece demo only. Any other query must use Live grid. */
export function isFixtureQuery(query: string): boolean {
  return query.toLowerCase().includes("fleece");
}

export const FIXTURE_LISTINGS: Listing[] = [
  {
    id: "mislisting-22",
    title: "Nike Tech Fleece Full-Zip Hoodie Black M",
    price_pence: 2200,
    merchant: "dealz_direct_uk",
    venue: "marketplace_unprotected",
    image_urls: ["/fixtures/bomber-black.jpg"],
    returns_text: "No returns",
    delivery_text: "£3.99 delivery, 5–7 days",
    rating: "3.8",
  },
  {
    id: "private-28",
    title: "Black fleece zip hoodie, medium, worn twice",
    price_pence: 2800,
    merchant: "Facebook Marketplace · Tom K",
    seller_type_hint: "private",
    venue: "stranger",
    image_urls: ["/fixtures/fleece-black-private.jpg"],
    returns_text: "Collection only, no returns",
    delivery_text: "Collection only",
  },
  {
    id: "shop-36",
    title: "Black Full-Zip Fleece Hoodie – Medium",
    price_pence: 3600,
    merchant: "JD Sports",
    seller_type_hint: "uk_business",
    venue: "shop_checkout",
    image_urls: ["/fixtures/fleece-black.jpg"],
    returns_text: "Free 14-day returns",
    delivery_text: "Free delivery, 2–3 days",
    rating: "4.6",
    url: "https://www.jdsports.co.uk/",
  },
  {
    id: "overseas-34",
    title: "Men Black Fleece Zip Hoodie Jacket Medium Warm Winter",
    price_pence: 3400,
    merchant: "GlobalStyle Outlet",
    seller_type_hint: "overseas_business",
    venue: "marketplace_unprotected",
    image_urls: ["/fixtures/fleece-black-overseas.jpg"],
    returns_text: "Buyer pays return shipping to warehouse (CN)",
    delivery_text: "Ships from overseas, 12–20 days",
    rating: "3.1",
  },
];
