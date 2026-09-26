/**
 * Browser reader — owned by the Reader agent.
 *
 * Opens `https://www.google.com/search?q=QUERY&udm=28&hl=en&gl=uk` in Playwright
 * Chromium, waits for `product-viewer-entrypoint` or `div.mnr-c.pla-unit`, reads the
 * first paint (both the sponsored row and the browse grid), maps into `Offer`, dedupes,
 * and returns a `ReaderResponse`. On a challenge page it returns
 * `{ ok: false, error: { kind: "challenge" } }`. No bypass, no paging.
 */
export type { ReaderResponse, ReaderError, SearchResult, Offer } from "@/lib/types";
