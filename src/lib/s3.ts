/**
 * S3 receipts — owned by the Infra agent.
 *
 * Contract: on Approve, write one object `receipts/{id}.json` (a `Receipt`)
 * to `process.env.S3_BUCKET` (covered-hack-616532055961) in `eu-west-2`.
 * Offer snapshots go to `searches/{slug(query)}/{iso}.json`.
 * Credentials come from the default AWS credential chain (local `default`
 * profile on the laptop); nothing is read from the repo.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Receipt } from "@/lib/types";

export const S3_BUCKET = process.env.S3_BUCKET ?? "covered-hack-616532055961";
export const AWS_REGION = process.env.AWS_REGION ?? "eu-west-2";

let client: S3Client | null = null;

/** Lazily built so importing this module never touches the credential chain. */
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({ region: AWS_REGION });
  }
  return client;
}

/** Key for a receipt object. */
export function receiptKey(id: string): string {
  return `receipts/${id}.json`;
}

/** URL-safe slug for a search query, used as the `searches/` folder name. */
export function slug(query: string): string {
  const s = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "query";
}

/** Key for a search snapshot object. */
export function searchSnapshotKey(query: string, iso: string): string {
  return `searches/${slug(query)}/${iso}.json`;
}

async function putJson(key: string, body: unknown): Promise<{ key: string }> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: JSON.stringify(body, null, 2),
      ContentType: "application/json",
    }),
  );
  return { key };
}

/** Where a receipt landed. "local" means S3 was unreachable and it lives in this server process only. */
export type ReceiptStore = "s3" | "local";

const LOCAL_RECEIPTS_MAX = 500;
type ReceiptGlobal = typeof globalThis & { __coveredLocalReceipts?: Map<string, Receipt> };
/** Survives Next dev HMR module reloads, like the memory store's local Map. */
const g = globalThis as ReceiptGlobal;

function localReceipts(): Map<string, Receipt> {
  if (!g.__coveredLocalReceipts) g.__coveredLocalReceipts = new Map<string, Receipt>();
  return g.__coveredLocalReceipts;
}

/**
 * Write a `Receipt` to `receipts/{id}.json`. When S3 is unreachable (no credentials,
 * no bucket) the receipt is kept in this process instead, so Approve still works on a
 * laptop without AWS, the same way memory and the judge degrade. Never throws; the
 * reason is logged and returned.
 */
export async function putReceipt(
  receipt: Receipt,
): Promise<{ key: string; store: ReceiptStore; reason?: string }> {
  const key = receiptKey(receipt.id);
  try {
    await putJson(key, receipt);
    return { key, store: "s3" };
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn(`[covered/s3] receipt ${receipt.id} kept in-process, S3 unavailable: ${reason}`);
    const local = localReceipts();
    local.set(receipt.id, receipt);
    if (local.size > LOCAL_RECEIPTS_MAX) {
      const oldest = local.keys().next().value;
      if (oldest !== undefined) local.delete(oldest);
    }
    return { key, store: "local", reason };
  }
}

/** A receipt kept in-process because S3 was unreachable when it was approved. */
export function getLocalReceipt(id: string): Receipt | null {
  return localReceipts().get(id) ?? null;
}

/** Write a search snapshot to `searches/{slug(query)}/{iso}.json`. */
export async function putSearchSnapshot(
  query: string,
  payload: unknown,
): Promise<{ key: string }> {
  const iso = new Date().toISOString();
  return putJson(searchSnapshotKey(query, iso), payload);
}
