/**
 * POST /api/approve — owned by the Infra agent.
 *
 * Body: a `Receipt` without `id` / `created_at`. The server assigns both,
 * writes `receipts/{id}.json` to S3 and returns `{ ok: true, id, key }`.
 * GET /api/approve?id= reads a stored receipt back (demo convenience).
 */
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AWS_REGION, S3_BUCKET, putReceipt, receiptKey } from "@/lib/s3";
import { ReceiptSchema, type Receipt } from "@/lib/types";

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
});

type ApproveOk = { ok: true; id: string; key: string };
type ApproveErr = { ok: false; error: string };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

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

  const receipt: Receipt = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...parsed.data,
  };

  try {
    const { key } = await putReceipt(receipt);
    return NextResponse.json({ ok: true, id: receipt.id, key });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `S3 write failed: ${errorMessage(err)}` },
      { status: 502 },
    );
  }
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
      { ok: false, error: `S3 read failed: ${errorMessage(err)}` },
      { status: 502 },
    );
  }
}
