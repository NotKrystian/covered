/**
 * POST /api/decide — owned by Judge+Memory.
 *
 * Body: `{ query, settings?, display_name?, source: "fixture" }` or `{ query, settings?, offers: Offer[] }`.
 * Builds the shortlist, loads this buyer's memory, asks the Bedrock judge (or the mock),
 * applies the pound rule in code, records a `decision` event, and returns `DecideResponse`
 * with a visible trace. Memory shapes the model's lean only; the pound rule never reads it.
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
import { getUserId } from "@/lib/memory/identity";
import { DISPLAY_NAME_MAX, getMemory, memoryPromptBlock, memoryStore, recordEvent } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  query: z.string().min(1),
  settings: UserSettingsSchema.partial().optional(),
  display_name: z.string().max(DISPLAY_NAME_MAX).optional(),
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

  const { userId, isNew } = await getUserId();
  const memory = await getMemory(userId);
  const memoryBlock = memoryPromptBlock(memory);
  const store = memoryStore();
  if (memoryBlock) {
    log(
      "learned",
      `${memory.events.length} past event${memory.events.length === 1 ? "" : "s"}${memory.summary ? `, summary: "${memory.summary.slice(0, 120)}${memory.summary.length > 120 ? "…" : ""}"` : ", no summary yet"} [${store.store}]`,
    );
  } else {
    log("memory", `${isNew ? "new buyer" : "nothing learned yet"} [${store.store}${store.store === "local" ? `: ${store.reason.slice(0, 80)}` : ""}]`);
  }

  const judged = await judge(body.query, settings, items, { memory: memoryBlock });
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

  try {
    await recordEvent(
      userId,
      {
        kind: "decision",
        query: body.query,
        chosen_id: verdict.chosen_id ?? undefined,
        premium_pence: settings.protection_premium_pence,
        note: chosen
          ? `bot picked ${chosen.id} (${chosen.merchant} ${chosen.price_label}), ${mislistings} mislisting dropped`
          : "bot found nothing to buy",
      },
      { settings, display_name: body.display_name },
    );
    log("memory", `recorded decision [${memoryStore().store}]`);
  } catch (err) {
    log("memory", `record failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const response: DecideResponse = {
    verdict,
    decisions: judged.decisions,
    shortlist: items,
    mode: judged.mode,
    model: judged.model,
    trace,
    premium_paid_pence: premiumPaid(items, judged.decisions, verdict),
    learned: memoryBlock !== null,
  };
  return NextResponse.json(response);
}
