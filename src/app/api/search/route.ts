/**
 * POST /api/search  { query: string }  ->  ReaderResponse
 *
 * Runs the Playwright reader on the laptop (Node runtime). Expected outcomes
 * (challenge, timeout, no_offers) come back as `{ ok: false, error }` with 200
 * so the UI can switch to fixtures; only a malformed body is a 4xx.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { readGrid } from "@/lib/reader";
import type { ReaderResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({ query: z.string().trim().min(1).max(200) });

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

  const response = await readGrid(parsed.data.query);
  return NextResponse.json(response, { status: 200 });
}
