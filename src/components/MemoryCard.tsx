"use client";

import type { Memory, MemoryEvent } from "@/lib/memory";
import { formatPence } from "@/lib/money";

type Props = {
  memory: Memory | null;
  /** "dynamodb" or "local" (in-process fallback), or null before the first load. */
  store: string | null;
  loading: boolean;
  onReset: () => void;
};

function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

function eventLine(e: MemoryEvent): string {
  const who = e.chosen_id ? ` ${e.chosen_id}` : "";
  return `${e.kind}${who} · ${formatPence(e.premium_pence)} premium`;
}

export function MemoryCard({ memory, store, loading, onReset }: Props) {
  const events = memory ? memory.events.filter((e) => e.kind !== "decision").slice(-3).reverse() : [];
  const empty = !memory || (events.length === 0 && !memory.summary && memory.balance_pence === 0 && memory.orders.length === 0);
  return (
    <section className="border-t border-line px-3 py-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="uppercase tracking-wide text-muted">Memory</span>
          {store && (
            <span
              className="rounded-full border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted"
              title={store === "dynamodb" ? "Stored in DynamoDB covered-memory" : "DynamoDB unreachable; kept in this server process only"}
            >
              {store}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onReset}
          disabled={loading}
          className="rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:border-danger hover:text-danger disabled:opacity-40"
        >
          Reset memory
        </button>
      </div>
      {empty ? (
        <p className="text-muted">Nothing learned yet. Approve a pick and the bot starts remembering how you buy.</p>
      ) : (
        <>
          {memory.display_name && <p className="mb-1 font-medium text-foreground">{memory.display_name}</p>}
          <p className="leading-relaxed text-foreground">
            {memory.summary || <span className="text-muted">Summary appears after your first approval.</span>}
          </p>
          {events.length > 0 && (
            <ol className="mt-2 space-y-1 font-mono">
              {events.map((e, i) => (
                <li key={`${e.t}-${i}`} className="grid grid-cols-[6.2rem_1fr] gap-2">
                  <span className="tnum text-muted">{day(e.t)}</span>
                  <span className="min-w-0">
                    <span className="text-accent">{eventLine(e)}</span>
                    <span className="block truncate text-muted" title={e.note}>
                      {e.note}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
