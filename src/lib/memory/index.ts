/**
 * Preference memory — owned by Judge+Memory.
 *
 * One DynamoDB item per anonymous user (`covered-memory`, PK `user_id`) holding a short
 * model-written summary of how this buyer buys, their settings, and the last 25 events.
 * `/api/decide` injects the summary and the last 5 events into the judge prompt; the
 * pound rule and the mislisting rule never read it.
 *
 * When DynamoDB is unreachable (no credentials, no table) the store degrades to a
 * per-process Map so mock mode always works. Every write is capped by `MemorySchema`.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { UserSettingsSchema } from "@/lib/types";
import type { UserSettings } from "@/lib/types";
import { BEDROCK_REGION } from "@/lib/judge/bedrock";

export const MEMORY_TABLE = process.env.COVERED_MEMORY_TABLE ?? "covered-memory";
export const MEMORY_REGION = BEDROCK_REGION;

export const SUMMARY_MAX = 600;
export const EVENTS_MAX = 25;
export const NOTE_MAX = 200;
export const QUERY_MAX = 200;
export const DISPLAY_NAME_MAX = 40;

export const MemoryEventKindSchema = z.enum(["decision", "approve", "override"]);
export type MemoryEventKind = z.infer<typeof MemoryEventKindSchema>;

export const MemoryEventSchema = z.object({
  /** ISO 8601 timestamp. */
  t: z.string(),
  kind: MemoryEventKindSchema,
  query: z.string().max(QUERY_MAX),
  /** Shortlist id the verdict picked (decision), the user bought (approve), or switched to (override). */
  chosen_id: z.string().max(80).optional(),
  /** Protection premium in force, in pence. */
  premium_pence: z.number().int(),
  /** One line: what happened, e.g. "shop-36 JD Sports £36, £8 paid for rights". */
  note: z.string().max(NOTE_MAX),
});
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export const MemorySchema = z.object({
  user_id: z.string().min(1).max(64),
  /** Optional name the user typed into the settings strip. */
  display_name: z.string().max(DISPLAY_NAME_MAX).optional(),
  /** Model-written, ≤ 3 sentences. Empty until the first approve/override. */
  summary: z.string().max(SUMMARY_MAX),
  settings: UserSettingsSchema,
  /** Newest last. Capped at EVENTS_MAX. */
  events: z.array(MemoryEventSchema).max(EVENTS_MAX),
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
    updated_at: new Date().toISOString(),
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
  });
}

export async function getMemory(userId: string): Promise<Memory> {
  if (storeMode === "dynamodb") {
    try {
      const out = await client().send(new GetCommand({ TableName: MEMORY_TABLE, Key: { user_id: userId } }));
      if (!out.Item) return emptyMemory(userId);
      const parsed = MemorySchema.safeParse(out.Item);
      if (parsed.success) return parsed.data;
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

/** Append one event (newest last), keep the last EVENTS_MAX, persist. Also refreshes settings/name when given. */
export async function recordEvent(
  userId: string,
  event: NewMemoryEvent,
  extras: { settings?: UserSettings; display_name?: string } = {},
): Promise<Memory> {
  const current = await getMemory(userId);
  const next: Memory = {
    ...current,
    settings: extras.settings ?? current.settings,
    display_name: extras.display_name?.trim() ? extras.display_name.trim() : current.display_name,
    events: [...current.events, { ...event, t: event.t ?? new Date().toISOString() }].slice(-EVENTS_MAX),
  };
  return saveMemory(userId, next);
}

/**
 * The block the judge sees. Only the summary and the last five events, in plain words.
 * Returns null when there is nothing worth telling the model.
 */
export function memoryPromptBlock(memory: Memory): string | null {
  const recent = memory.events.slice(-5);
  if (!memory.summary && recent.length === 0) return null;
  const lines: string[] = ["WHAT WE KNOW ABOUT THIS BUYER (from their own past decisions; it may shape your recommendation and your sentence, never same_item or mislisting):"];
  if (memory.display_name) lines.push(`- Name: ${memory.display_name}`);
  if (memory.summary) lines.push(`- Summary: ${memory.summary}`);
  if (recent.length > 0) {
    lines.push("- Recent events (oldest first):");
    for (const e of recent) {
      lines.push(`  · ${e.t.slice(0, 10)} ${e.kind}${e.chosen_id ? ` ${e.chosen_id}` : ""} — "${e.query}" — ${e.note}`);
    }
  }
  return lines.join("\n");
}
