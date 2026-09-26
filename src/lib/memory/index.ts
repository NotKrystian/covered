/**
 * Preference memory — owned by Judge+Memory.
 *
 * One DynamoDB item per anonymous user (`covered-memory`, PK `user_id`) holding a short
 * model-written summary of how this buyer buys, their settings, the last 25 events,
 * approved orders, and a demo wallet. `/api/decide` may READ memory for the judge
 * prompt but never writes it. Only an approve (from `/api/approve` or POST
 * `/api/memory`) or an explicit override may write events.
 *
 * Decision events are not stored. Any already in DynamoDB are ignored when building
 * the prompt and the Memory card. Reset (DELETE /api/memory) is the only wipe.
 *
 * When DynamoDB is unreachable the store degrades to a per-process Map so mock
 * mode always works. Every write is capped by `MemorySchema`.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { ReceiptSectionSchema, UserSettingsSchema } from "@/lib/types";
import type { UserSettings } from "@/lib/types";
import { BEDROCK_REGION } from "@/lib/judge/bedrock";

export const MEMORY_TABLE = process.env.COVERED_MEMORY_TABLE ?? "covered-memory";
export const MEMORY_REGION = BEDROCK_REGION;

export const SUMMARY_MAX = 600;
export const EVENTS_MAX = 25;
export const NOTE_MAX = 200;
export const QUERY_MAX = 200;
export const DISPLAY_NAME_MAX = 40;
export const ORDERS_MAX = 50;
export const DEPOSITS_MAX = 20;
export const TITLE_MAX = 200;
export const MERCHANT_MAX = 120;
/** A single deposit cannot exceed £500. */
export const WALLET_DEPOSIT_MAX_PENCE = 50_000;
/** Wallet balance cannot exceed £2,000. */
export const WALLET_BALANCE_MAX_PENCE = 200_000;

export const MemoryEventKindSchema = z.enum(["decision", "approve", "override"]);
export type MemoryEventKind = z.infer<typeof MemoryEventKindSchema>;

export const MemoryEventSchema = z.object({
  /** ISO 8601 timestamp. */
  t: z.string(),
  kind: MemoryEventKindSchema,
  query: z.string().max(QUERY_MAX),
  /** Shortlist id the user bought (approve) or switched to (override). */
  chosen_id: z.string().max(80).optional(),
  /** Protection premium in force, in pence. */
  premium_pence: z.number().int(),
  /** One line: what happened, e.g. "shop-36 JD Sports £36, £8 paid for rights". */
  note: z.string().max(NOTE_MAX),
});
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export const OrderRecordSchema = z.object({
  id: z.string().max(80),
  /** ISO 8601 timestamp. */
  t: z.string(),
  query: z.string().max(QUERY_MAX),
  title: z.string().max(TITLE_MAX),
  merchant: z.string().max(MERCHANT_MAX),
  price_pence: z.number().int(),
  section: ReceiptSectionSchema,
});
export type OrderRecord = z.infer<typeof OrderRecordSchema>;

export const DepositSchema = z.object({
  t: z.string(),
  amount_pence: z.number().int().positive(),
});
export type Deposit = z.infer<typeof DepositSchema>;

export const MemorySchema = z.object({
  user_id: z.string().min(1).max(64),
  /** Optional name the user typed into the settings strip. */
  display_name: z.string().max(DISPLAY_NAME_MAX).optional(),
  /** Model-written, ≤ 3 sentences. Empty until the first approve. */
  summary: z.string().max(SUMMARY_MAX),
  settings: UserSettingsSchema,
  /** Newest last. Capped at EVENTS_MAX. Decision rows may still exist in old items. */
  events: z.array(MemoryEventSchema).max(EVENTS_MAX),
  /** Newest last. Approved purchases only. Capped at ORDERS_MAX. */
  orders: z.array(OrderRecordSchema).max(ORDERS_MAX).default([]),
  /** Demo ledger, not a real card. Integer pence. */
  balance_pence: z.number().int().nonnegative().default(0),
  /** Newest last. Capped at DEPOSITS_MAX. */
  deposits: z.array(DepositSchema).max(DEPOSITS_MAX).default([]),
  /** ISO 8601 timestamp. */
  updated_at: z.string(),
});
export type Memory = z.infer<typeof MemorySchema>;

export function emptyMemory(userId: string): Memory {
  return {
    user_id: userId,
    summary: "",
    settings: UserSettingsSchema.parse({}),
    events: [],
    orders: [],
    balance_pence: 0,
    deposits: [],
    updated_at: new Date().toISOString(),
  };
}

/** Events the UI and the judge may treat as buyer history. Decision rows are ignored. */
export function visibleEvents(memory: Memory): MemoryEvent[] {
  return memory.events.filter((e) => e.kind === "approve" || e.kind === "override");
}

export function purchaseEvents(memory: Memory): MemoryEvent[] {
  return memory.events.filter((e) => e.kind === "approve");
}

export function hasPurchaseHistory(memory: Memory): boolean {
  return purchaseEvents(memory).length > 0;
}

/**
 * Memory as the card and the judge should see it: decision events stripped.
 * Summary is cleared when there is no approve — old decision-only summaries
 * must not be presented as purchase history.
 */
export function publicMemory(memory: Memory): Memory {
  const events = visibleEvents(memory);
  return {
    ...memory,
    events,
    summary: hasPurchaseHistory(memory) ? memory.summary : "",
  };
}

/** Where the last read/write went. Surfaces in the trace so a demo never lies about storage. */
export type MemoryStore = "dynamodb" | "local";

const local = new Map<string, Memory>();
let docClient: DynamoDBDocumentClient | null = null;
let storeMode: MemoryStore = "dynamodb";
let storeReason = "";

function client(): DynamoDBDocumentClient {
  if (docClient === null) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: MEMORY_REGION }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

function fallBack(err: unknown): void {
  if (storeMode === "local") return;
  storeMode = "local";
  storeReason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.warn(`[covered/memory] DynamoDB unavailable, using in-process memory: ${storeReason}`);
}

/** Which store is live right now and, when local, why. */
export function memoryStore(): { store: MemoryStore; reason: string } {
  return { store: storeMode, reason: storeReason };
}

function mergeStored(userId: string, item: unknown): Memory | null {
  const parsed = MemorySchema.safeParse({ ...emptyMemory(userId), ...(item as object) });
  return parsed.success ? parsed.data : null;
}

/** Trim to the schema's caps before validation so an oversize model answer never throws. */
export function capMemory(memory: Memory): Memory {
  return MemorySchema.parse({
    ...memory,
    summary: memory.summary.slice(0, SUMMARY_MAX),
    display_name: memory.display_name?.slice(0, DISPLAY_NAME_MAX) || undefined,
    events: memory.events.slice(-EVENTS_MAX).map((e) => ({
      ...e,
      query: e.query.slice(0, QUERY_MAX),
      note: e.note.slice(0, NOTE_MAX),
    })),
    orders: memory.orders.slice(-ORDERS_MAX).map((o) => ({
      ...o,
      query: o.query.slice(0, QUERY_MAX),
      title: o.title.slice(0, TITLE_MAX),
      merchant: o.merchant.slice(0, MERCHANT_MAX),
    })),
    deposits: memory.deposits.slice(-DEPOSITS_MAX),
    balance_pence: Math.max(0, Math.min(WALLET_BALANCE_MAX_PENCE, Math.round(memory.balance_pence))),
  });
}

export async function getMemory(userId: string): Promise<Memory> {
  if (storeMode === "dynamodb") {
    try {
      const out = await client().send(new GetCommand({ TableName: MEMORY_TABLE, Key: { user_id: userId } }));
      if (!out.Item) return emptyMemory(userId);
      const parsed = mergeStored(userId, out.Item);
      if (parsed) return parsed;
      console.warn(`[covered/memory] stored item for ${userId} failed validation; starting fresh`);
      return emptyMemory(userId);
    } catch (err) {
      fallBack(err);
    }
  }
  return local.get(userId) ?? emptyMemory(userId);
}

export async function saveMemory(userId: string, memory: Memory): Promise<Memory> {
  const item = capMemory({ ...memory, user_id: userId, updated_at: new Date().toISOString() });
  if (storeMode === "dynamodb") {
    try {
      await client().send(new PutCommand({ TableName: MEMORY_TABLE, Item: item }));
      return item;
    } catch (err) {
      fallBack(err);
    }
  }
  local.set(userId, item);
  return item;
}

export async function deleteMemory(userId: string): Promise<void> {
  local.delete(userId);
  if (storeMode === "dynamodb") {
    try {
      await client().send(new DeleteCommand({ TableName: MEMORY_TABLE, Key: { user_id: userId } }));
    } catch (err) {
      fallBack(err);
    }
  }
}

export type NewMemoryEvent = Omit<MemoryEvent, "t"> & { t?: string };

/** Append one approve/override event (newest last), keep the last EVENTS_MAX, persist. */
export async function recordEvent(
  userId: string,
  event: NewMemoryEvent,
  extras: { settings?: UserSettings; display_name?: string } = {},
): Promise<Memory> {
  if (event.kind === "decision") {
    console.warn("[covered/memory] refusing to record a decision event");
    return getMemory(userId);
  }
  const current = await getMemory(userId);
  const next: Memory = {
    ...current,
    settings: extras.settings ?? current.settings,
    display_name: extras.display_name?.trim() ? extras.display_name.trim() : current.display_name,
    events: [...current.events, { ...event, t: event.t ?? new Date().toISOString() }].slice(-EVENTS_MAX),
  };
  return saveMemory(userId, next);
}

export type WalletWrite =
  | { ok: true; memory: Memory }
  | { ok: false; error: string };

/** Add a deposit. Rejects negative, over £500, or a balance that would exceed £2,000. */
export async function depositWallet(userId: string, amountPence: number): Promise<WalletWrite> {
  if (!Number.isInteger(amountPence) || amountPence <= 0) {
    return { ok: false, error: "Deposit must be a positive amount" };
  }
  if (amountPence > WALLET_DEPOSIT_MAX_PENCE) {
    return { ok: false, error: "A single deposit cannot exceed £500" };
  }
  const current = await getMemory(userId);
  if (current.balance_pence + amountPence > WALLET_BALANCE_MAX_PENCE) {
    return { ok: false, error: "Wallet balance cannot exceed £2,000" };
  }
  const memory = await saveMemory(userId, {
    ...current,
    balance_pence: current.balance_pence + amountPence,
    deposits: [...current.deposits, { t: new Date().toISOString(), amount_pence: amountPence }].slice(-DEPOSITS_MAX),
  });
  return { ok: true, memory };
}

export type DebitAndPurchaseInput = {
  pricePence: number;
  order: OrderRecord;
  event: NewMemoryEvent;
  extras?: { settings?: UserSettings; display_name?: string };
};

export type DebitAndPurchaseResult =
  | { ok: true; memory: Memory }
  | { ok: false; short_by_pence: number; balance_pence: number };

/**
 * If the wallet covers `pricePence`, debit it, append the order, and record the
 * approve event in one write. Does not write a decision event.
 */
export async function debitAndRecordPurchase(
  userId: string,
  input: DebitAndPurchaseInput,
): Promise<DebitAndPurchaseResult> {
  if (input.event.kind === "decision") {
    const current = await getMemory(userId);
    return { ok: false, short_by_pence: 0, balance_pence: current.balance_pence };
  }
  const current = await getMemory(userId);
  if (current.balance_pence < input.pricePence) {
    return {
      ok: false,
      short_by_pence: input.pricePence - current.balance_pence,
      balance_pence: current.balance_pence,
    };
  }
  const next: Memory = {
    ...current,
    settings: input.extras?.settings ?? current.settings,
    display_name: input.extras?.display_name?.trim()
      ? input.extras.display_name.trim()
      : current.display_name,
    balance_pence: current.balance_pence - input.pricePence,
    orders: [...current.orders, input.order].slice(-ORDERS_MAX),
    events: [...current.events, { ...input.event, t: input.event.t ?? new Date().toISOString() }].slice(
      -EVENTS_MAX,
    ),
  };
  const memory = await saveMemory(userId, next);
  return { ok: true, memory };
}

/**
 * The block the judge sees. Only approve events are purchases. Decision-only
 * history is treated as no purchase history.
 */
export function memoryPromptBlock(memory: Memory): string {
  const approvals = purchaseEvents(memory).slice(-5);
  const overrides = visibleEvents(memory)
    .filter((e) => e.kind === "override")
    .slice(-5);
  const lines: string[] = ["WHAT WE KNOW ABOUT THIS BUYER:"];
  if (approvals.length === 0) {
    lines.push("- There is no purchase history. The buyer has not approved any purchase.");
    lines.push(
      '- Never say they "bought this", "approved this", or "bought this before". Those phrases are only allowed when an approve event exists.',
    );
    if (memory.display_name) lines.push(`- Name: ${memory.display_name}`);
    if (overrides.length > 0) {
      lines.push("- They have overridden a recommendation without approving a purchase (not a purchase):");
      for (const e of overrides) {
        lines.push(
          `  · ${e.t.slice(0, 10)} override${e.chosen_id ? ` ${e.chosen_id}` : ""} — "${e.query}" — ${e.note}`,
        );
      }
    }
    return lines.join("\n");
  }

  lines.push(
    "(from their own approved purchases; it may shape your recommendation and your sentence, never same_item or mislisting)",
  );
  if (memory.display_name) lines.push(`- Name: ${memory.display_name}`);
  if (memory.summary) lines.push(`- Summary: ${memory.summary}`);
  lines.push(
    "- Approved purchases (oldest first). ONLY these are purchases. Never say \"you bought this\" / \"you approved this\" / \"you bought this before\" unless that listing appears here as an approve:",
  );
  for (const e of approvals) {
    lines.push(`  · ${e.t.slice(0, 10)} approve${e.chosen_id ? ` ${e.chosen_id}` : ""} — "${e.query}" — ${e.note}`);
  }
  if (overrides.length > 0) {
    lines.push("- Overrides (the buyer chose a different listing than recommended; not a purchase unless also approved):");
    for (const e of overrides) {
      lines.push(
        `  · ${e.t.slice(0, 10)} override${e.chosen_id ? ` ${e.chosen_id}` : ""} — "${e.query}" — ${e.note}`,
      );
    }
  }
  return lines.join("\n");
}
