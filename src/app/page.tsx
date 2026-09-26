"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_USER_SETTINGS, ReaderResponseSchema } from "@/lib/types";
import type { Offer, Receipt, UserSettings } from "@/lib/types";
import { isProtected, type DecideResponse } from "@/lib/decision";
import type { Memory } from "@/lib/memory";
import { FIXTURE_QUERY } from "@/lib/fixtures";
import { formatPence } from "@/lib/money";
import { SettingsStrip } from "@/components/SettingsStrip";
import { ChatPanel, type ChatMessage, type SourceKind } from "@/components/ChatPanel";
import { Shortlist } from "@/components/Shortlist";
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

/** Try the Reader agent's endpoint. Returns offers, or a reason to fall back. */
async function readLiveGrid(
  query: string,
): Promise<{ ok: true; offers: Offer[] } | { ok: false; reason: string }> {
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (res.status === 404) return { ok: false, reason: "search endpoint not wired yet" };
    const json: unknown = await res.json();
    const parsed = ReaderResponseSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: `unexpected reader response (${res.status})` };
    if (!parsed.data.ok) {
      return { ok: false, reason: `${parsed.data.error.kind}: ${parsed.data.error.message}` };
    }
    if (parsed.data.result.offers.length === 0) return { ok: false, reason: "no_offers: grid was empty" };
    return { ok: true, offers: parsed.data.result.offers };
  } catch (err) {
    return { ok: false, reason: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
}
async function decide(
  query: string,
  settings: UserSettings,
  displayName: string,
  offers?: Offer[],
): Promise<DecideResponse> {
  const name = displayName.trim() || undefined;
  const body = offers
    ? { query, settings, display_name: name, offers }
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
  const [source, setSource] = useState<SourceKind>("fixture");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [result, setResult] = useState<DecideResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [receiptLine, setReceiptLine] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [memoryState, setMemoryState] = useState<MemoryState | null>(null);
  const [memoryBusy, setMemoryBusy] = useState(false);

  const push = useCallback((m: ChatMessage) => setMessages((prev) => [...prev, m]), []);

  const refreshMemory = useCallback(async () => {
    const next = await fetchMemory();
    if (next) {
      setMemoryState(next);
      if (next.memory.display_name) setDisplayName((cur) => cur || next.memory.display_name || "");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMemory().then((next) => {
      if (cancelled || !next) return;
      setMemoryState(next);
      if (next.memory.display_name) setDisplayName((cur) => cur || next.memory.display_name || "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        let offers: Offer[] | undefined;
        if (nextSource === "live") {
          const read = await readLiveGrid(q);
          if (read.ok) {
            offers = read.offers;
          } else {
            push(msg("bot", `Live grid unavailable (${read.reason}). Using the fixtures instead.`, "warn"));
            setSource("fixture");
          }
        }
        const data = await decide(q, settings, displayName, offers);
        setResult(data);
        const chosen = data.shortlist.find((i) => i.id === data.verdict.chosen_id);
        const chosenDecision = chosen ? data.decisions[chosen.id] : undefined;
        const tone: ChatMessage["tone"] = chosenDecision && isProtected(chosenDecision) ? "good" : "warn";
        push(msg("bot", data.verdict.summary, tone));
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