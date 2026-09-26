/**
 * POST /api/decide — owned by Judge+Memory.
 *
 * Body: `{ query, settings?, display_name?, source: "fixture" }` or `{ query, settings?, offers: Offer[] }`.
 * Researches the product, builds the shortlist (top 12 by brief, all listings kept),
 * loads this buyer's memory (read-only), asks the Bedrock judge (or the mock),
 * applies the pound rule in code, and returns `DecideResponse` with a visible trace.
 * Decide never writes memory. Only approve/override events are purchases.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { OfferSchema, ReaderErrorSchema, SearchSourceSchema, UserSettingsSchema } from "@/lib/types";
import { FIXTURE_LISTINGS, isFixtureQuery } from "@/lib/fixtures";
import { judge, researchProduct, researchTraceDetail } from "@/lib/judge";
import {
  applyPremium,
  buildShortlistFromOffers,
  listingToItem,
  premiumPaid,
  type DecideResponse,
  type ShortlistItem,
  type TraceEvent,
} from "@/lib/decision";
import { formatPence } from "@/lib/money";
import { getUserId } from "@/lib/memory/identity";
import {
  DISPLAY_NAME_MAX,
  getMemory,
  hasPurchaseHistory,
  memoryPromptBlock,
  memoryStore,
  publicMemory,
} from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  query: z.string().min(1),
  settings: UserSettingsSchema.partial().optional(),
  display_name: z.string().max(DISPLAY_NAME_MAX).optional(),
  source: z.literal("fixture").optional(),
  offers: z.array(OfferSchema).optional(),
  /** Where `offers` came from, so the trace can say "snapshot captured …" instead of pretending it was live. */
  grid: z
    .object({
      source: SearchSourceSchema,
      fetched_at: z.string(),
      note: z.string().optional(),
      fallback_from: ReaderErrorSchema.optional(),
    })
    .optional(),
});

function gridLabel(grid: NonNullable<z.infer<typeof BodySchema>["grid"]> | undefined): string {
  if (!grid) return "grid";
  switch (grid.source) {
    case "live":
      return `live Google Shopping grid read ${grid.fetched_at}`;
    case "snapshot":
      return `real Google Shopping grid captured ${grid.fetched_at}${grid.fallback_from ? ` (live read failed: ${grid.fallback_from.kind})` : ""}`;
    case "fixture":
      return "fixture offers";
    default: {
      const never: never = grid.source;
      return String(never);
    }
  }
}

export async function POST(request: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const settings = UserSettingsSchema.parse(body.settings ?? {});
  const trace: TraceEvent[] = [];
  const log = (tool: string, detail: string) => {
    trace.push({ t: new Date().toISOString(), tool, detail });
  };

  const researched = await researchProduct(body.query);
  log("research", researchTraceDetail(researched.brief, researched.source));

  const useFixtures = body.source === "fixture" || !body.offers;
  let items: ShortlistItem[];
  let listings: ShortlistItem[];
  if (useFixtures) {
    if (!isFixtureQuery(body.query)) {
      return NextResponse.json(
        { error: "Fixtures are the black fleece demo. Switch to Live grid for this search." },
        { status: 400 },
      );
    }
    items = FIXTURE_LISTINGS.map(listingToItem);
    listings = items;
    log("read_fixtures", `${items.length} listings for "${body.query}"`);
  } else {
    const offers = body.offers ?? [];
    const built = buildShortlistFromOffers(offers, researched.brief);
    items = built.items;
    const judgedIds = new Set(items.map((i) => i.id));
    listings = built.all.map((item) => (judgedIds.has(item.id) ? item : { ...item, image_data_url: null }));
    const sponsored = items.filter((i) => i.section === "sponsored").length;
    const withPhotos = items.filter((i) => Boolean(i.image_data_url) || i.image_urls.length > 0).length;
    log(
      "read_grid",
      `${gridLabel(body.grid)}: ${offers.length} offers → ${listings.length} listings, ${items.length} sent to the judge (${built.deduped} duplicates dropped, ${sponsored} ads marked, ${withPhotos} with photos)`,
    );
  }

  const { userId, isNew } = await getUserId();
  const stored = await getMemory(userId);
  const memory = publicMemory(stored);
  const memoryBlock = memoryPromptBlock(memory);
  const store = memoryStore();
  const learned = hasPurchaseHistory(memory);
  if (learned) {
    log(
      "learned",
      `${memory.events.filter((e) => e.kind === "approve").length} approved purchase${memory.events.filter((e) => e.kind === "approve").length === 1 ? "" : "s"}${memory.summary ? `, summary: "${memory.summary.slice(0, 120)}${memory.summary.length > 120 ? "…" : ""}"` : ", no summary yet"} [${store.store}]`,
    );
  } else {
    log(
      "memory",
      `${isNew ? "new buyer" : "no purchase history"} [${store.store}${store.store === "local" ? `: ${store.reason.slice(0, 80)}` : ""}]`,
    );
  }

  const judged = await judge(body.query, settings, items, {
    memory: memoryBlock,
    brief: researched.brief,
  });
  for (const note of judged.notes) log("judge", note);
  const values = Object.values(judged.decisions);
  const mislistings = values.filter((d) => d.mislisting).length;
  const notItem = values.filter((d) => !d.mislisting && !d.same_item).length;
  const kept = values.length - mislistings - notItem;
  log(
    "judge",
    `${kept} kept, ${mislistings} mislisting${mislistings === 1 ? "" : "s"}${notItem ? `, ${notItem} not the item` : ""} [${judged.mode}: ${judged.model}]`,
  );

  const verdict = applyPremium(items, judged.decisions, settings);
  const chosen = items.find((i) => i.id === verdict.chosen_id);
  log(
    "apply_premium",
    `${formatPence(settings.protection_premium_pence)} → ${chosen ? `${chosen.id} (${chosen.merchant} ${chosen.price_label})` : "nothing"}`,
  );

  const response: DecideResponse = {
    verdict,
    decisions: judged.decisions,
    shortlist: items,
    listings,
    mode: judged.mode,
    model: judged.model,
    trace,
    premium_paid_pence: premiumPaid(items, judged.decisions, verdict),
    learned,
  };
  return NextResponse.json(response);
}
