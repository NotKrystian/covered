/**
 * POST /api/decide — owned by the Decision+UI agent.
 *
 * Body: `{ query, settings?, source: "fixture" }` or `{ query, settings?, offers: Offer[] }`.
 * Builds the shortlist, asks the Bedrock judge (or the mock), applies the pound rule in code,
 * and returns `DecideResponse` with a visible trace.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { OfferSchema, UserSettingsSchema } from "@/lib/types";
import { FIXTURE_LISTINGS } from "@/lib/fixtures";
import { judge } from "@/lib/judge";
import {
  applyPremium,
  buildShortlistFromOffers,
  listingToItem,
  premiumPaid,
  type DecideResponse,
  type TraceEvent,
} from "@/lib/decision";
import { formatPence } from "@/lib/money";

const BodySchema = z.object({
  query: z.string().min(1),
  settings: UserSettingsSchema.partial().optional(),
  source: z.literal("fixture").optional(),
  offers: z.array(OfferSchema).optional(),
});

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

  const useFixtures = body.source === "fixture" || !body.offers;
  let items;
  if (useFixtures) {
    items = FIXTURE_LISTINGS.map(listingToItem);
    log("read_fixtures", `${items.length} listings for "${body.query}"`);
  } else {
    const offers = body.offers ?? [];
    const built = buildShortlistFromOffers(offers);
    items = built.items;
    const sponsored = items.filter((i) => i.section === "sponsored").length;
    log(
      "read_grid",
      `${offers.length} offers → ${items.length} shortlisted (${built.deduped} duplicates dropped, ${sponsored} ads marked)`,
    );
  }

  const judged = await judge(body.query, settings, items);
  for (const note of judged.notes) log("judge", note);
  const values = Object.values(judged.decisions);
  const mislistings = values.filter((d) => d.mislisting).length;
  const notItem = values.filter((d) => !d.mislisting && !d.same_item).length;
  const kept = values.length - mislistings - notItem;
  log(
    "judge",
    `${kept} kept, ${mislistings} mislisting${mislistings === 1 ? "" : "s"}${notItem ? `, ${notItem} not the item` : ""} [${judged.mode}]`,
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
    mode: judged.mode,
    model: judged.model,
    trace,
    premium_paid_pence: premiumPaid(items, judged.decisions, verdict),
  };
  return NextResponse.json(response);
}
