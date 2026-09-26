/**
 * CLI: read the udm=28 first paint for a query and print counts plus the
 * first 3 records per section.
 *
 *   npx tsx scripts/read-grid.ts "samsung 50 inch tv"
 *
 * Attach to the user's own Chrome instead of a headless profile:
 *
 *   scripts/chrome-debug.sh
 *   COVERED_READER_CDP=http://127.0.0.1:9222 npx tsx scripts/read-grid.ts "samsung 50 inch tv"
 *
 * (`tsx` resolves the `@/` path alias from tsconfig.json.)
 */
import { closeBrowser, readGrid } from "../src/lib/reader";
import { cdpUrl, readerMode } from "../src/lib/reader/browser";
import type { Offer } from "../src/lib/types";

async function main(): Promise<number> {
  const query = process.argv.slice(2).join(" ").trim();
  if (query.length === 0) {
    console.error('usage: npx tsx scripts/read-grid.ts "samsung 50 inch tv"');
    return 2;
  }

  const mode = readerMode();
  console.log(`mode=${mode}${mode === "cdp" ? ` (${cdpUrl()})` : ""}`);

  const started = Date.now();
  const response = await readGrid(query);
  const elapsed = Date.now() - started;

  if (!response.ok) {
    console.log(`\n${response.error.kind.toUpperCase()} after ${elapsed}ms: ${response.error.message}`);
    return 1;
  }

  const { result } = response;
  const bySection = (section: Offer["section"]): Offer[] =>
    result.offers.filter((offer) => offer.section === section);
  const sponsored = bySection("sponsored");
  const browse = bySection("browse");

  console.log(`\nquery="${result.query}" source=${result.source} fetched_at=${result.fetched_at} (${elapsed}ms)`);
  console.log(`sponsored: ${sponsored.length}  browse: ${browse.length}  total: ${result.offers.length}`);

  for (const [label, offers] of [
    ["sponsored", sponsored],
    ["browse", browse],
  ] as const) {
    console.log(`\n--- ${label} (first ${Math.min(3, offers.length)} of ${offers.length}) ---`);
    for (const offer of offers.slice(0, 3)) {
      console.log(JSON.stringify(offer, null, 2));
    }
  }
  return 0;
}

main()
  .then(async (code) => {
    await closeBrowser();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await closeBrowser();
    process.exit(1);
  });
