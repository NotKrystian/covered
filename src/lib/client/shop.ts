/**
 * Shared client helpers for search, decide, memory and approve.
 */
import { DEFAULT_USER_SETTINGS, ReaderResponseSchema } from "@/lib/types";
import type { Offer, Receipt, SearchResult, UserSettings } from "@/lib/types";
import type { DecideResponse } from "@/lib/decision";
import type { Limit, Memory } from "@/lib/memory";
import { isExtensionSearchError, searchViaExtension } from "@/lib/reader/extension";

export type ReceiptBody = Omit<Receipt, "id" | "created_at">;
export type MemoryState = { memory: Memory; store: string };
export type MemoryApiResponse = { ok: true; memory: Memory; store: string } | { ok: false; error: string };
export type SearchAttempt = { ok: true; result: SearchResult } | { ok: false; reason: string };

export async function fetchMemory(init?: RequestInit): Promise<MemoryState | null> {
  try {
    const res = await fetch("/api/memory", init);
    if (!res.ok) return null;
    const json = (await res.json()) as MemoryApiResponse;
    if (!json.ok) return null;
    return { memory: json.memory, store: json.store };
  } catch {
    return null;
  }
}

export async function patchMemory(body: {
  display_name?: string;
  settings?: Partial<UserSettings>;
  onboarded?: boolean;
}): Promise<MemoryState | null> {
  try {
    const res = await fetch("/api/memory", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as MemoryApiResponse;
    if (!json.ok) return null;
    return { memory: json.memory, store: json.store };
  } catch {
    return null;
  }
}

export async function postSearch(
  query: string,
  offers?: Offer[],
): Promise<SearchAttempt> {
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(offers ? { query, offers } : { query }),
    });
    if (res.status === 404) return { ok: false, reason: "search endpoint not wired yet" };
    const json: unknown = await res.json();
    const parsed = ReaderResponseSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: `unexpected reader response (${res.status})` };
    if (!parsed.data.ok) {
      return { ok: false, reason: `${parsed.data.error.kind}: ${parsed.data.error.message}` };
    }
    if (parsed.data.result.offers.length === 0) return { ok: false, reason: "no_offers: grid was empty" };
    return { ok: true, result: parsed.data.result };
  } catch (err) {
    return { ok: false, reason: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function liveGridErrorKind(reason: string): "no_extension" | "challenge" | "other" {
  if (reason === "no_extension" || reason.startsWith("no_extension")) return "no_extension";
  if (reason === "challenge" || reason.startsWith("challenge")) return "challenge";
  return "other";
}

export function liveGridErrorLine(reason: string): string {
  const kind = liveGridErrorKind(reason);
  switch (kind) {
    case "no_extension":
      return "Install the Covered reader extension so this search runs in your Google session";
    case "challenge":
      return "Google challenged this tab";
    case "other":
      return `Live grid unavailable (${reason}).`;
    default: {
      const never: never = kind;
      return String(never);
    }
  }
}

export async function readLiveGrid(query: string): Promise<SearchAttempt> {
  const ext = await searchViaExtension(query);
  if (!isExtensionSearchError(ext)) {
    return postSearch(query, ext);
  }
  const server = await postSearch(query);
  if (server.ok) return server;
  return { ok: false, reason: ext.error };
}

export async function decide(
  query: string,
  settings: UserSettings,
  displayName: string,
  read?: SearchResult,
): Promise<DecideResponse> {
  const name = displayName.trim() || undefined;
  const body = read
    ? {
        query,
        settings,
        display_name: name,
        offers: read.offers,
        grid: { source: read.source, fetched_at: read.fetched_at, note: read.note, fallback_from: read.fallback_from },
      }
    : { query, settings, display_name: name, source: "fixture" as const };
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`decide failed (${res.status})`);
  return (await res.json()) as DecideResponse;
}

export type ApproveResult =
  | { ok: true; id: string; balance_pence: number }
  | { ok: false; status: number; error: string };

export async function approveChosen(
  query: string,
  result: DecideResponse,
  settings: UserSettings = DEFAULT_USER_SETTINGS,
): Promise<ApproveResult> {
  if (result.verdict.chosen_id === null) return { ok: false, status: 400, error: "Nothing to approve." };
  const chosen = result.listings.find((i) => i.id === result.verdict.chosen_id)
    ?? result.shortlist.find((i) => i.id === result.verdict.chosen_id);
  const decision = chosen ? result.decisions[chosen.id] : undefined;
  if (!chosen || !decision) return { ok: false, status: 400, error: "Chosen listing is missing." };
  const body: ReceiptBody & { chosen_id: string } = {
    query,
    chosen: chosen.raw.kind === "offer" ? chosen.raw.offer : chosen.raw.listing,
    decision,
    section: chosen.section,
    protection_premium_pence: settings.protection_premium_pence,
    chosen_id: chosen.id,
  };
  try {
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; id?: string; error?: string; balance_pence?: number }
      | null;
    if (res.status === 402) {
      return { ok: false, status: 402, error: json?.error ?? "Wallet is short." };
    }
    if (!res.ok || !json?.ok || !json.id) {
      return { ok: false, status: res.status, error: json?.error ?? `Approve failed (${res.status}).` };
    }
    return { ok: true, id: json.id, balance_pence: json.balance_pence ?? 0 };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "Approve failed." };
  }
}

export async function depositWallet(amountPence: number): Promise<{ ok: true; balance_pence: number } | { ok: false; error: string }> {
  if (!Number.isInteger(amountPence) || amountPence < 0) {
    return { ok: false, error: "Enter a whole-pound amount" };
  }
  if (amountPence === 0) return { ok: true, balance_pence: 0 };
  try {
    const res = await fetch("/api/wallet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount_pence: amountPence }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; balance_pence?: number; error?: string }
      | null;
    if (!res.ok || !json?.ok || typeof json.balance_pence !== "number") {
      return { ok: false, error: json?.error ?? `Deposit failed (${res.status})` };
    }
    return { ok: true, balance_pence: json.balance_pence };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Deposit failed" };
  }
}

export type LimitsResult = { ok: true; limits: Limit[] } | { ok: false; error: string };

export async function fetchLimits(): Promise<Limit[]> {
  try {
    const res = await fetch("/api/limits");
    const json = (await res.json().catch(() => null)) as { ok?: boolean; limits?: Limit[] } | null;
    if (!res.ok || !json?.ok || !Array.isArray(json.limits)) return [];
    return json.limits;
  } catch {
    return [];
  }
}

export async function createLimit(query: string, maxPricePence: number): Promise<LimitsResult> {
  try {
    const res = await fetch("/api/limits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, max_price_pence: maxPricePence }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; limits?: Limit[]; error?: string }
      | null;
    if (!res.ok || !json?.ok || !Array.isArray(json.limits)) {
      return { ok: false, error: json?.error ?? `Could not save the limit (${res.status})` };
    }
    return { ok: true, limits: json.limits };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save the limit" };
  }
}

export async function removeLimit(id: string): Promise<LimitsResult> {
  try {
    const res = await fetch(`/api/limits?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; limits?: Limit[]; error?: string }
      | null;
    if (!res.ok || !json?.ok || !Array.isArray(json.limits)) {
      return { ok: false, error: json?.error ?? `Could not remove the limit (${res.status})` };
    }
    return { ok: true, limits: json.limits };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not remove the limit" };
  }
}
