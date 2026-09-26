"use client";

import { useEffect, useRef } from "react";
import { formatPence } from "@/lib/money";

export type ChatMessage = {
  id: string;
  role: "user" | "bot";
  text: string;
  tone?: "neutral" | "warn" | "good";
  /** True on the verdict line, the only message that carries the Approve button. */
  verdict?: boolean;
};

export type SourceKind = "live" | "fixture";

type Props = {
  messages: ChatMessage[];
  query: string;
  onQuery: (q: string) => void;
  onRun: (source: SourceKind) => void;
  source: SourceKind;
  running: boolean;
  canApprove: boolean;
  onApprove: () => void;
  approving: boolean;
  receiptLine: string | null;
  /** Set after a paid order: points at the 14-day price-drop watch on the home page. */
  watchTeaser?: { switchMinimumPence: number } | null;
};

export function ChatPanel({
  messages,
  query,
  onQuery,
  onRun,
  source,
  running,
  canApprove,
  onApprove,
  approving,
  receiptLine,
  watchTeaser = null,
}: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const showWatch = watchTeaser !== null;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, receiptLine, showWatch]);

  const lastBotIndex = messages.map((m) => m.role).lastIndexOf("bot");

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-line bg-panel">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted">
            Ask for something. The bot rejects mislistings from the photos, then prices your
            rights against the gap.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[92%] rounded-2xl rounded-br-sm bg-panel-raised px-3.5 py-2 text-sm text-foreground"
                  : `max-w-[92%] rounded-2xl rounded-bl-sm border px-3.5 py-2 text-sm leading-relaxed ${
                      m.tone === "warn"
                        ? "border-danger/40 bg-danger-soft text-foreground"
                        : m.tone === "good"
                          ? "border-accent/40 bg-accent-soft text-foreground"
                          : "border-line bg-background text-foreground"
                    }`
              }
            >
              {m.text}
              {m.role === "bot" && m.verdict && i === lastBotIndex && canApprove && !receiptLine && (
                <div className="mt-2.5">
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={approving || running}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-50"
                  >
                    {approving ? "Approving…" : "Approve"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {receiptLine && (
          <div className="flex justify-start">
            <div className="tnum max-w-[92%] rounded-2xl rounded-bl-sm border border-accent/40 bg-accent-soft px-3.5 py-2 text-sm text-foreground">
              {receiptLine}
            </div>
          </div>
        )}
        {receiptLine && watchTeaser && (
          <div className="flex justify-start">
            <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-line px-3.5 py-2 text-sm text-muted">
              <p className="flex flex-wrap items-center gap-2 text-foreground">
                14-day price-drop watch
                <span className="rounded-full border border-accent/40 px-1.5 py-px text-[10px] uppercase tracking-wide text-accent">
                  On
                </span>
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                For your cooling-off window, Covered re-checks this price and offers a switch if you would clear{" "}
                {formatPence(watchTeaser.switchMinimumPence)} after return postage. Manage it on the home page.
              </p>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => onRun("live")}
            disabled={running}
            className={`rounded border px-2 py-1 disabled:opacity-50 ${
              source === "live" ? "border-accent text-foreground" : "border-line text-muted hover:text-foreground"
            }`}
          >
            Live grid
          </button>
          <button
            type="button"
            onClick={() => onRun("fixture")}
            disabled={running}
            className={`rounded border px-2 py-1 disabled:opacity-50 ${
              source === "fixture" ? "border-accent text-foreground" : "border-line text-muted hover:text-foreground"
            }`}
          >
            Fixtures
          </button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onRun(source);
          }}
        >
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="black fleece jacket medium"
            className="min-w-0 flex-1 rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={running || query.trim().length === 0}
            className="rounded-md border border-line bg-panel-raised px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
          >
            {running ? "…" : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
}
