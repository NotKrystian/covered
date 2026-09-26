"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_USER_SETTINGS, ReaderResponseSchema } from "@/lib/types";
import type { Offer, Receipt, SearchResult, UserSettings } from "@/lib/types";
import { isProtected, type DecideResponse } from "@/lib/decision";
import type { Memory } from "@/lib/memory";
import { FIXTURE_LISTINGS, FIXTURE_QUERY, isFixtureQuery } from "@/lib/fixtures";
import { formatPence } from "@/lib/money";
import { isExtensionSearchError, searchViaExtension } from "@/lib/reader/extension";
import { SettingsStrip } from "@/components/SettingsStrip";
import { ChatPanel, type ChatMessage, type SourceKind } from "@/components/ChatPanel";
import { Shortlist, type ShortlistSource } from "@/components/Shortlist";
import { TracePanel } from "@/components/TracePanel";
import { MemoryCard } from "@/components/MemoryCard";

type ReceiptBody = Omit<Receipt, "id" | "created_at">;

type MemoryState = { memory: Memory; store: string };

/** Body of `GET`/`POST /api/memory`. */
type MemoryApiResponse = { ok: true; memory: Memory; store: string } | { ok: false; error: string };

async function fetchMemory(init?: RequestInit): Promise<MemoryState | null> {
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

let messageSeq = 0;
function msg(role: ChatMessage["role"], text: string, tone?: ChatMessage["tone"]): ChatMessage {
  messageSeq += 1;
  return { id: `m${messageSeq}`, role, text, tone };
}

/** POST offers (or just the query) to `/api/search`. Offers skip the server Playwright path. */
async function postSearch(
  query: string,
  offers?: Offer[],
): Promise<{ ok: true; result: SearchResult } | { ok: false; reason: string }> {
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

function liveGridErrorLine(reason: string): string {
  switch (reason) {
    case "no_extension":
      return "Install the Covered reader extension so this search runs in your Google session";
    case "challenge":
      return "Google challenged this tab";
    default:
      return `Live grid unavailable (${reason}).`;
  }
}

/**
 * Live grid: ask the user's extension first. On success, ingest those offers
 * (no Playwright). If the extension is missing or challenged, try the server
 * path (exact-slug snapshot only). Never substitute the fleece fixtures.
 */
async function readLiveGrid(
  query: string,
): Promise<{ ok: true; result: SearchResult } | { ok: false; reason: string }> {
  const ext = await searchViaExtension(query);
  if (!isExtensionSearchError(ext)) {
    return postSearch(query, ext);
  }
  const server = await postSearch(query);
  if (server.ok) return server;
  return { ok: false, reason: ext.error };
}

function sourceOf(result: SearchResult): ShortlistSource {
  return {
    source: result.source,
    fetched_at: result.fetched_at,
    note: result.note,
    fallback_from: result.fallback_from,
    offers: result.offers.length,
  };
}

const FIXTURE_SOURCE: ShortlistSource = {
  source: "fixture",
  fetched_at: "",
  offers: FIXTURE_LISTINGS.length,
};

function whenCaptured(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return today ? `today at ${time}` : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** One honest line about where the rows came from, for the chat. Null when it was a plain live read. */
function sourceLine(result: SearchResult): string | null {
  switch (result.source) {
    case "live":
      return null;
    case "snapshot": {
      const why = result.fallback_from
        ? result.fallback_from.kind === "challenge"
          ? "Google served a challenge page to the headless reader"
          : `live read failed (${result.fallback_from.kind})`
        : "live read skipped";
      return `${why}, so this is a real Google Shopping grid for this query captured ${whenCaptured(result.fetched_at)}: ${result.offers.length} offers, ads marked.`;
    }
    case "fixture":
      return null;
    default: {
      const never: never = result.source;
      return String(never);
    }
  }
}

async function decide(
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

export default function Home() {
  const [query, setQuery] = useState(FIXTURE_QUERY);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [source, setSource] = useState<SourceKind>("live");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [result, setResult] = useState<DecideResponse | null>(null);
  const [shortlistSource, setShortlistSource] = useState<ShortlistSource | null>(null);
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [receiptLine, setReceiptLine] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [memoryState, setMemoryState] = useState<MemoryState | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);

  const push = useCallback((m: ChatMessage) => setMessages((prev) => [...prev, m]), []);

  const applyMemory = useCallback((next: MemoryState) => {
    setMemoryState(next);
    if (next.memory.display_name) setDisplayName((cur) => cur || next.memory.display_name || "");
  }, []);

  const refreshMemory = useCallback(async () => {
    const next = await fetchMemory();
    if (next) applyMemory(next);
  }, [applyMemory]);

  // Initial load: state is set from the fetch callback, never synchronously in the effect.
  useEffect(() => {
    let cancelled = false;
    fetchMemory().then((next) => {
      if (!cancelled && next) applyMemory(next);
    });
    return () => {
      cancelled = true;
    };
  }, [applyMemory]);

  const forget = useCallback(async () => {
    setMemoryBusy(true);
    try {
      await fetch("/api/memory", { method: "DELETE" });
      setDisplayName("");
      await refreshMemory();
      push(msg("bot", "Forgotten. Next run starts from nothing.", "neutral"));
    } finally {
      setMemoryBusy(false);
    }
  }, [refreshMemory, push]);

  const run = useCallback(
    async (nextSource: SourceKind) => {
      const q = query.trim();
      if (!q || running) return;
      setSource(nextSource);
      setRunning(true);
      setReceiptLine(null);
      push(msg("user", q));
      try {
        let read: SearchResult | undefined;
        switch (nextSource) {
          case "fixture":
            if (!isFixtureQuery(q)) {
              push(
                msg("bot", "Fixtures are the black fleece demo. Switch to Live grid for this search.", "warn"),
              );
              return;
            }
            break;
          case "live": {
            const attempt = await readLiveGrid(q);
            if (!attempt.ok) {
              push(msg("bot", liveGridErrorLine(attempt.reason), "warn"));
              return;
            }
            read = attempt.result;
            const line = sourceLine(read);
            if (line) push(msg("bot", line, "neutral"));
            break;
          }
          default: {
            const never: never = nextSource;
            throw new Error(`unknown source: ${String(never)}`);
          }
        }
        const data = await decide(q, settings, displayName, read);
        setResult(data);
        setShortlistSource(read ? sourceOf(read) : FIXTURE_SOURCE);
        const chosen = data.shortlist.find((i) => i.id === data.verdict.chosen_id);
        const chosenDecision = chosen ? data.decisions[chosen.id] : undefined;
        const tone: ChatMessage["tone"] = chosenDecision && isProtected(chosenDecision) ? "good" : "warn";
        push({ ...msg("bot", data.verdict.summary, tone), verdict: true });
        void refreshMemory();
      } catch (err) {
        push(msg("bot", `Something broke: ${err instanceof Error ? err.message : String(err)}`, "warn"));
      } finally {
        setRunning(false);
      }
    },
    [query, running, settings, displayName, push, refreshMemory],
  );

  const approve = useCallback(async () => {
    if (!result || result.verdict.chosen_id === null) return;
    const chosen = result.shortlist.find((i) => i.id === result.verdict.chosen_id);
    const decision = chosen ? result.decisions[chosen.id] : undefined;
    if (!chosen || !decision) return;
    setApproving(true);
    const body: ReceiptBody = {
      query,
      chosen: chosen.raw.kind === "offer" ? chosen.raw.offer : chosen.raw.listing,
      decision,
      section: chosen.section,
      protection_premium_pence: settings.protection_premium_pence,
    };
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 404) {
        setReceiptLine("Approved locally. Receipt endpoint not wired yet.");
        return;
      }
      const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; key?: string; error?: string } | null;
      if (!res.ok || !json?.ok || !json.id) {
        setReceiptLine(`Approve failed (${res.status}${json?.error ? `: ${json.error}` : ""}).`);
        return;
      }
      const paid = result.premium_paid_pence ?? 0;
      setReceiptLine(
        `Bought ${chosen.merchant} ${chosen.price_label} · ${formatPence(paid)} paid for rights · receipt ${json.id}`,
      );
      // Teach the memory: this is the pick the user actually took.
      setMemoryBusy(true);
      const remembered = await fetchMemory({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "approve",
          query,
          chosen_id: chosen.id,
          premium_pence: settings.protection_premium_pence,
          note: `approved ${chosen.id} (${chosen.merchant} ${chosen.price_label}), ${formatPence(paid)} paid for rights, ${decision.seller_type} at ${decision.venue_trust}`,
          display_name: displayName.trim() || undefined,
        }),
      });
      if (remembered) setMemoryState(remembered);
      setMemoryBusy(false);
    } catch (err) {
      setReceiptLine(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApproving(false);
      setMemoryBusy(false);
    }
  }, [result, query, settings.protection_premium_pence, displayName]);

  return (
    <div className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-background text-foreground">
      <SettingsStrip
        settings={settings}
        onChange={setSettings}
        displayName={displayName}
        onDisplayName={setDisplayName}
        onRun={() => run(source)}
        running={running}
      />
      <div className="grid min-h-0 grid-cols-[20rem_minmax(0,1fr)_auto]">
        <ChatPanel
          messages={messages}
          query={query}
          onQuery={setQuery}
          onRun={run}
          source={source}
          running={running}
          canApprove={result !== null && result.verdict.chosen_id !== null}
          onApprove={approve}
          approving={approving}
          receiptLine={receiptLine}
        />
        <main className="min-h-0 min-w-0 overflow-x-auto">
          <Shortlist
            items={result?.shortlist ?? []}
            decisions={result?.decisions ?? {}}
            chosenId={result?.verdict.chosen_id ?? null}
            loading={running}
            source={shortlistSource}
          />
        </main>
        <TracePanel
          trace={result?.trace ?? []}
          mode={result?.mode ?? null}
          model={result?.model ?? null}
          open={traceOpen}
          onToggle={() => setTraceOpen((o) => !o)}
          footer={
            <MemoryCard
              memory={memoryState?.memory ?? null}
              store={memoryState?.store ?? null}
              loading={memoryBusy}
              onForget={forget}
            />
          }
        />
      </div>
    </div>
  );
}