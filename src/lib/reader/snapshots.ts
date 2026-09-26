/**
 * Saved live reads in `public/snapshots/<slug>.json`.
 *
 * Captured with the Cursor browser (see the Reader notes) when the laptop's
 * network is served a challenge, and used as the fallback for a failed live
 * read only when the slug matches the query exactly. A snapshot is a
 * `SearchResult` with `source: "snapshot"` and a `note` on how it was captured.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { parsePricePence } from "@/lib/money";
import { SearchResultSchema, type Offer, type SearchResult } from "@/lib/types";
import { dedupeBrowse, dedupeSponsored } from "./dedupe";
import type { GridExtraction } from "./extract";
import { MAX_PER_SECTION } from "./limits";

export const SNAPSHOT_NOTE = "captured via Cursor browser";

/** Directory holding the snapshot JSON files. Served statically by Next as well. */
export function snapshotDir(): string {
  return path.join(process.cwd(), "public", "snapshots");
}

/** "Nike Tech Fleece, black (medium)" -> "nike-tech-fleece-black-medium" */
export function slugify(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function words(value: string): Set<string> {
  return new Set(slugify(value).split("-").filter((w) => w.length > 0));
}

/** Build the snapshot document from a raw extraction, applying the same dedupe/cap/pence as the live path. */
export function buildSnapshot(query: string, extraction: GridExtraction, fetchedAt = new Date()): SearchResult {
  const withPence = (offer: Offer): Offer => ({ ...offer, price_pence: parsePricePence(offer.price) });
  const sponsored = dedupeSponsored(extraction.sponsored.map(withPence)).slice(0, MAX_PER_SECTION);
  const browse = dedupeBrowse(extraction.browse.map(withPence)).slice(0, MAX_PER_SECTION);
  return {
    query,
    fetched_at: fetchedAt.toISOString(),
    source: "snapshot",
    offers: [...sponsored, ...browse],
    note: SNAPSHOT_NOTE,
  };
}

/** Write `<slug>.json` and refresh `index.json`. Returns the slug. */
export async function writeSnapshot(result: SearchResult): Promise<string> {
  const slug = slugify(result.query);
  const dir = snapshotDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${slug}.json`), `${JSON.stringify(result, null, 2)}\n`);
  const slugs = await listSnapshotSlugs();
  await fs.writeFile(path.join(dir, "index.json"), `${JSON.stringify({ slugs }, null, 2)}\n`);
  return slug;
}

/** Slugs of every `<slug>.json` in the snapshot dir (index.json excluded), sorted. */
export async function listSnapshotSlugs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(snapshotDir());
    return entries
      .filter((name) => name.endsWith(".json") && name !== "index.json")
      .map((name) => name.slice(0, -".json".length))
      .sort();
  } catch {
    return [];
  }
}

/** Load and validate one snapshot, or null when missing/invalid. */
export async function loadSnapshot(slug: string): Promise<SearchResult | null> {
  try {
    const raw = await fs.readFile(path.join(snapshotDir(), `${slug}.json`), "utf8");
    const parsed = SearchResultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type SnapshotMatch = { slug: string; exact: boolean; shared: number; result: SearchResult };

/**
 * Exact slug only. A closest-match on shared words serves the wrong catalog
 * (a TV query must not get the fleece or 50-inch snapshot).
 */
export async function findSnapshot(query: string): Promise<SnapshotMatch | null> {
  const slug = slugify(query);
  const exact = await loadSnapshot(slug);
  if (exact) return { slug, exact: true, shared: words(slug).size, result: exact };
  return null;
}
