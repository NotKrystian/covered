/**
 * POST /api/approve — owned by the Infra agent.
 *
 * Debits the demo wallet, writes `receipts/{id}.json` to S3, appends a compact
 * order on the DynamoDB memory item, and records the approve memory event.
 * If the wallet is short, returns 402 and writes nothing.
 * GET /api/approve?id= reads a stored receipt back (demo convenience).
 */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AWS_REGION, S3_BUCKET, receiptKey } from "@/lib/s3";
import { ReceiptSchema, type Receipt } from "@/lib/types";
import { getUserId } from "@/lib/memory/identity";
import { fulfillPurchase } from "@/lib/fulfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the UI sends on Approve: `{ query, chosen, decision, section,
 * protection_premium_pence }`. The server fills `id` and `created_at`.
 * (Not exported: Next only allows route fields as exports from route.ts.)
 */
const ApproveRequestSchema = ReceiptSchema.omit({
  id: true,
  created_at: true,
}).extend({
  /** Shortlist id, so the approve event can name the pick. */
  chosen_id: z.string().max(80).optional(),
});

type ApproveOk = { ok: true; id: string; key: string; balance_pence: number };
type ApproveErr = { ok: false; error: string };

export async function POST(
  request: Request,
): Promise<NextResponse<ApproveOk | ApproveErr>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be JSON" },
      { status: 400 },
    );
  }

  const parsed = ApproveRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: z.prettifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { userId } = await getUserId();
  const done = await fulfillPurchase({
    userId,
    query: parsed.data.query,
    chosen: parsed.data.chosen,
    decision: parsed.data.decision,
    section: parsed.data.section,
    protection_premium_pence: parsed.data.protection_premium_pence,
    chosen_id: parsed.data.chosen_id,
  });
  if (!done.ok) {
    return NextResponse.json({ ok: false, error: done.error }, { status: done.status });
  }
  return NextResponse.json(done);
}

const IdSchema = z.string().uuid();

export async function GET(
  request: Request,
): Promise<NextResponse<Receipt | ApproveErr>> {
  const id = new URL(request.url).searchParams.get("id");
  const parsedId = IdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { ok: false, error: "Query param `id` must be a UUID" },
      { status: 400 },
    );
  }

  try {
    const client = new S3Client({ region: AWS_REGION });
    const out = await client.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: receiptKey(parsedId.data) }),
    );
    const text = await out.Body?.transformToString();
    if (!text) {
      return NextResponse.json(
        { ok: false, error: "Empty receipt" },
        { status: 502 },
      );
    }
    const receipt = ReceiptSchema.parse(JSON.parse(text));
    return NextResponse.json(receipt);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "NoSuchKey") {
      return NextResponse.json(
        { ok: false, error: "Receipt not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { ok: false, error: `S3 read failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
