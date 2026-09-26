"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_USER_SETTINGS } from "@/lib/types";
import type { SearchResult, UserSettings } from "@/lib/types";
import { isProtected, type DecideResponse } from "@/lib/decision";
import { FIXTURE_LISTINGS, FIXTURE_QUERY, isFixtureQuery } from "@/lib/fixtures";
import { formatPence } from "@/lib/money";
import {
  approveChosen,
  decide,
  fetchMemory,
  liveGridErrorLine,
  readLiveGrid,
  type MemoryState,
} from "@/lib/client/shop";
import { clearOnboarding } from "@/lib/client/onboarding-progress";
import { SettingsStrip } from "@/components/SettingsStrip";
import { ChatPanel, type ChatMessage, type SourceKind } from "@/components/ChatPanel";
import { Shortlist, type ShortlistSource } from "@/components/Shortlist";
import { TracePanel } from "@/components/TracePanel";
import { MemoryCard } from "@/components/MemoryCard";
import { WalletStrip } from "@/components/WalletStrip";
import { PaySheet } from "@/components/PaySheet";

let messageSeq = 0;
function msg(role: ChatMessage["role"], text: string, tone?: ChatMessage["tone"]): ChatMessage {
  messageSeq += 1;
  return { id: `m${messageSeq}`, role, text, tone };
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

export function DevWorkbench() {
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
  const [balancePence, setBalancePence] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  const push = useCallback((m: ChatMessage) => setMessages((prev) => [...prev, m]), []);

  const applyMemory = useCallback((next: MemoryState) => {
    setMemoryState(next);
    setBalancePence(next.memory.balance_pence ?? 0);
    if (next.memory.display_name) setDisplayName((cur) => cur || next.memory.display_name || "");
    if (next.memory.settings) setSettings((cur) => ({ ...cur, ...next.memory.settings }));
  }, []);

  const refreshMemory = useCallback(async () => {
    const next = await fetchMemory();
    if (next) applyMemory(next);
  }, [applyMemory]);

  useEffect(() => {
    let cancelled = false;
    fetchMemory().then((next) => {
      if (!cancelled && next) applyMemory(next);
    });
    return () => {
      cancelled = true;
    };
  }, [applyMemory]);

  const resetMemory = useCallback(async () => {
    setMemoryBusy(true);
    setMemoryState({
      memory: {
        user_id: "reset",
        summary: "",
        settings: DEFAULT_USER_SETTINGS,
        events: [],
        orders: [],
        balance_pence: 0,
        deposits: [],
        limits: [],
        onboarded: false,
        updated_at: new Date().toISOString(),
      },
      store: memoryState?.store ?? "local",
    });
    setBalancePence(0);
    setDisplayName("");
    // Also forget this browser's saved onboarding, or the home page would restore it.
    clearOnboarding();
    try {
      await fetch("/api/memory", { method: "DELETE" });
      await refreshMemory();
      push(msg("bot", "Memory reset. Next run starts from nothing.", "neutral"));
    } finally {
      setMemoryBusy(false);
    }
  }, [refreshMemory, push, memoryState?.store]);

  const run = useCallback(
    async (nextSource: SourceKind) => {
      const q = query.trim();
      if (!q || running) return;
      setSource(nextSource);
      setRunning(true);
      setReceiptLine(null);
      setPaid(false);
      push(msg("user", q));
      try {
        let read: SearchResult | undefined;
        switch (nextSource) {
          case "fixture":
            if (!isFixtureQuery(q)) {
              push(msg("bot", "Fixtures are the black fleece demo. Switch to Live grid for this search.", "warn"));
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
        const chosen = data.listings.find((i) => i.id === data.verdict.chosen_id)
          ?? data.shortlist.find((i) => i.id === data.verdict.chosen_id);
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
    setApproving(true);
    setPayError(null);
    try {
      const done = await approveChosen(query, result, settings);
      if (!done.ok) {
        setPayError(done.error);
        return;
      }
      setBalancePence(done.balance_pence);
      const premium = result.premium_paid_pence ?? 0;
      const chosen = result.listings.find((i) => i.id === result.verdict.chosen_id)
        ?? result.shortlist.find((i) => i.id === result.verdict.chosen_id);
      setPayOpen(false);
      setPaid(true);
      setReceiptLine(
        `✓ Paid ${chosen?.price_label ?? ""} to ${chosen?.merchant ?? "listing"} from your Covered demo wallet · ${formatPence(premium)} paid for rights · wallet ${formatPence(done.balance_pence)} · receipt ${done.id}`,
      );
      setMemoryBusy(true);
      await refreshMemory();
    } finally {
      setApproving(false);
      setMemoryBusy(false);
    }
  }, [result, query, settings, refreshMemory]);

  const chosenItem =
    result?.listings.find((i) => i.id === result.verdict.chosen_id)
    ?? result?.shortlist.find((i) => i.id === result.verdict.chosen_id)
    ?? null;
  const chosenRights = chosenItem ? (result?.decisions[chosenItem.id]?.rights ?? []) : [];

  return (
    <div className="grid h-screen grid-rows-[auto_1fr] overflow-hidden bg-background text-foreground">
      <SettingsStrip
        settings={settings}
        onChange={setSettings}
        displayName={displayName}
        onDisplayName={setDisplayName}
        onRun={() => run(source)}
        running={running}
        wallet={<WalletStrip compact balancePence={balancePence} onBalance={setBalancePence} />}
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
          onApprove={() => {
            setPayError(null);
            setPayOpen(true);
          }}
          approving={approving}
          receiptLine={receiptLine}
          watchTeaser={paid ? { switchMinimumPence: settings.switch_minimum_pence } : null}
        />
        <main className="min-h-0 min-w-0 overflow-x-auto">
          <Shortlist
            items={result?.shortlist ?? []}
            listings={result?.listings ?? []}
            decisions={result?.decisions ?? {}}
            chosenId={result?.verdict.chosen_id ?? null}
            loading={running}
            source={shortlistSource}
            briefBrand={result?.brief_brand ?? ""}
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
              onReset={resetMemory}
            />
          }
        />
      </div>
      {payOpen && chosenItem && (
        <PaySheet
          merchant={chosenItem.merchant}
          title={chosenItem.title}
          pricePence={chosenItem.price_pence}
          priceLabel={chosenItem.price_label}
          balancePence={balancePence}
          rights={chosenRights}
          paying={approving}
          error={payError}
          onPay={() => void approve()}
          onClose={() => setPayOpen(false)}
        />
      )}
    </div>
  );
}
