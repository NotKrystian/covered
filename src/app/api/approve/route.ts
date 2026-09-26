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
import { AWS_REGION, S3_BUCKET, putReceipt, receiptKey } from "@/lib/s3";
import { ReceiptSchema, type Listing, type Offer, type Receipt } from "@/lib/types";
import { formatPence, parsePricePence } from "@/lib/money";
import { getUserId } from "@/lib/memory/identity";
import { debitAndRecordPurchase, getMemory, publicMemory, saveMemory } from "@/lib/memory";
import { rewriteSummary } from "@/lib/memory/summary";

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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function chosenTitle(chosen: Offer | Listing): string {
  return chosen.title;
}

function chosenMerchant(chosen: Offer | Listing): string {
  return chosen.merchant;
}

function chosenPricePence(chosen: Offer | Listing): number | null {
  if ("price_pence" in chosen && typeof chosen.price_pence === "number") return chosen.price_pence;
  if ("price" in chosen && typeof chosen.price === "string") return parsePricePence(chosen.price);
  return null;
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

  const pricePence = chosenPricePence(parsed.data.chosen);
  if (pricePence === null || pricePence < 0) {
    return NextResponse.json({ ok: false, error: "Chosen listing has no price" }, { status: 400 });
  }

  const { userId } = await getUserId();
  const wallet = await getMemory(userId);
  if (wallet.balance_pence < pricePence) {
    return NextResponse.json(
      { ok: false, error: `Wallet is short by ${formatPence(pricePence - wallet.balance_pence)}` },
      { status: 402 },
    );
  }

  const { chosen_id: chosenId, ...receiptFields } = parsed.data;
  const receipt: Receipt = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    ...receiptFields,
  };
  const listingId = chosenId ?? ("id" in receipt.chosen ? receipt.chosen.id : undefined);

  try {
    const { key } = await putReceipt(receipt);
    const paid = await debitAndRecordPurchase(userId, {
      pricePence,
      order: {
        id: receipt.id,
        t: receipt.created_at,
        query: receipt.query,
        title: chosenTitle(receipt.chosen),
        merchant: chosenMerchant(receipt.chosen),
        price_pence: pricePence,
        section: receipt.section,
      },
      event: {
        kind: "approve",
        query: receipt.query,
        chosen_id: listingId,
        premium_pence: receipt.protection_premium_pence,
        note: `approved ${listingId ?? chosenMerchant(receipt.chosen)} (${chosenMerchant(receipt.chosen)} ${formatPence(pricePence)})`,
      },
    });
    if (!paid.ok) {
      return NextResponse.json(
        { ok: false, error: `Wallet is short by ${formatPence(paid.short_by_pence)}` },
        { status: 402 },
      );
    }
    const rewritten = await rewriteSummary(paid.memory);
    const saved = await saveMemory(userId, { ...paid.memory, summary: rewritten.summary });
    return NextResponse.json({
      ok: true,
      id: receipt.id,
      key,
      balance_pence: publicMemory(saved).balance_pence,
    });
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
