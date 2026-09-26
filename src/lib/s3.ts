/**
 * S3 receipts — owned by the Infra agent.
 *
 * Contract: on Approve, write one object `receipts/{id}.json` (a `Receipt`)
 * to `process.env.S3_BUCKET` (covered-hack-616532055961) in `eu-west-2`.
 * Offer snapshots may go to `searches/{query}/{timestamp}.json`.
 * Credentials come from the default AWS profile via the SDK chain; never from the repo.
 */
import type { Receipt } from "@/lib/types";

export const S3_BUCKET = process.env.S3_BUCKET ?? "covered-hack-616532055961";
export const AWS_REGION = process.env.AWS_REGION ?? "eu-west-2";

/** Key for a receipt object. */
export function receiptKey(id: string): string {
  return `receipts/${id}.json`;
}

/** Placeholder. Infra agent replaces with a real PutObject call. */
export async function putReceipt(receipt: Receipt): Promise<{ bucket: string; key: string }> {
  return { bucket: S3_BUCKET, key: receiptKey(receipt.id) };
}
