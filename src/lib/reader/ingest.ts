/**
 * Turn client-supplied grid rows (from the Covered reader extension) into a
 * SearchResult. Same pence parse, dedupe and cap as the Playwright path.
 */
import { parsePricePence } from "@/lib/money";
import type { Offer, SearchResult } from "@/lib/types";
import { dedupeBrowse, dedupeSponsored } from "./dedupe";
import { MAX_PER_SECTION } from "./limits";

export const BROWSER_READ_NOTE = "read in your browser";

export function ingestClientOffers(query: string, offers: Offer[]): SearchResult {
  const priced = offers.map((offer) => ({
    ...offer,
    price_pence: offer.price_pence ?? parsePricePence(offer.price),
  }));
  const sponsored = dedupeSponsored(priced.filter((o) => o.section === "sponsored")).slice(
    0,
    MAX_PER_SECTION,
  );
  const browse = dedupeBrowse(priced.filter((o) => o.section === "browse")).slice(0, MAX_PER_SECTION);
  return {
    query: query.trim(),
    fetched_at: new Date().toISOString(),
    source: "live",
    offers: [...sponsored, ...browse],
    note: BROWSER_READ_NOTE,
  };
}
