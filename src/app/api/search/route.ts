/**
 * POST /api/search
 *   { query }              -> Playwright / exact-slug snapshot (server path)
 *   { query, offers }      -> validate, mark live, skip the server browser
 *
 * Client-supplied offers are the Live grid path: they were read in the user's
 * own browser session. Do not launch Playwright when offers are present.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestClientOffers } from "@/lib/reader/ingest";
import { readGrid } from "@/lib/reader";
import { OfferSchema, type ReaderResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  query: z.string().trim().min(1).max(200),
  offers: z.array(OfferSchema).optional(),
});

export async function POST(request: Request): Promise<NextResponse<ReaderResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { kind: "unknown", message: "body must be JSON: { query: string }" } },
      { status: 400 },
    );
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { kind: "unknown", message: "query must be a non-empty string" } },
      { status: 400 },
    );
  }

  if (parsed.data.offers) {
    if (parsed.data.offers.length === 0) {
      return NextResponse.json(
        { ok: false, error: { kind: "no_offers", message: "client supplied an empty offer list" } },
        { status: 200 },
      );
    }
    const result = ingestClientOffers(parsed.data.query, parsed.data.offers);
    return NextResponse.json({ ok: true, result }, { status: 200 });
  }

  const response = await readGrid(parsed.data.query);
  return NextResponse.json(response, { status: 200 });
}
