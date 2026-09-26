"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderRecord } from "@/lib/memory";
import { formatPence } from "@/lib/money";
import { aftercareOutcomeLine, type AftercareAssist } from "@/lib/aftercare-schema";

type Turn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  draft: string | null;
  outcome: string | null;
  refused: boolean;
};

type Props = {
  orders: OrderRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

type AssistResponse = AftercareAssist & { error?: string };

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyIntro(): Turn {
  return {
    id: "intro",
    role: "assistant",
    text: "There is nothing to return yet. Approve a listing from the shop — that spends the bot wallet — and the order will show up here. Then I can draft a returns or fault letter for that seller.",
    draft: null,
    outcome: null,
    refused: false,
  };
}

function readyIntro(order: OrderRecord): Turn {
  return {
    id: `intro-${order.id}`,
    role: "assistant",
    text: `This is ${order.title} from ${order.merchant} (${formatPence(order.price_pence)}). Say if you want to return it, get a replacement, or get a repair because it is faulty. I will draft what to send ${order.merchant} — I will not email them.`,
    draft: null,
    outcome: null,
    refused: false,
  };
}

export function AftercareChat({ orders, selectedId, onSelect }: Props) {
  const selected = orders.find((o) => o.id === selectedId) ?? orders[0] ?? null;
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(() => (orders.length === 0 ? [emptyIntro()] : []));
  const [introFor, setIntroFor] = useState<{ count: number; order: OrderRecord | null } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  if (introFor === null || introFor.count !== orders.length || introFor.order !== selected) {
    setIntroFor({ count: orders.length, order: selected });
    if (orders.length === 0) setTurns([emptyIntro()]);
    else if (selected) setTurns([readyIntro(selected)]);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, sending]);

  async function copyDraft(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function send(): Promise<void> {
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    const userTurn: Turn = {
      id: newId(),
      role: "user",
      text: message,
      draft: null,
      outcome: null,
      refused: false,
    };
    const history = turns
      .filter((t) => !t.id.startsWith("intro"))
      .map((t) => ({ role: t.role, text: t.text }));
    setTurns((current) => [...current, userTurn]);
    setSending(true);
    try {
      const res = await fetch("/api/orders/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order_id: selected?.id,
          message,
          history,
        }),
      });
      const json = (await res.json()) as AssistResponse;
      if (!res.ok || json.error || !json.reply) {
        setTurns((current) => [
          ...current,
          {
            id: newId(),
            role: "assistant",
            text: json.error ?? "Could not draft that. Try again.",
            draft: null,
            outcome: null,
            refused: false,
          },
        ]);
        return;
      }
      setTurns((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: json.reply,
          draft: json.draft_to_seller,
          outcome: aftercareOutcomeLine(json),
          refused: json.refused,
        },
      ]);
    } catch {
      setTurns((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          text: "The aftercare service is unreachable. Try again in a moment.",
          draft: null,
          outcome: null,
          refused: false,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const lastDraft = [...turns].reverse().find((t) => t.draft)?.draft ?? null;

  return (
    <aside className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Returns and repairs</h2>
        <p className="mt-0.5 text-xs text-muted">Drafts the letter. You send it.</p>
        {orders.length > 0 && selected && (
          <label className="mt-2 block">
            <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted">Order</span>
            <select
              value={selected.id}
              onChange={(e) => onSelect(e.target.value)}
              className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent"
            >
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.merchant} · {o.title.slice(0, 42)} · {formatPence(o.price_pence)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.map((t) => (
          <div key={t.id} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                t.role === "user"
                  ? "max-w-[92%] rounded-2xl rounded-br-sm bg-panel-raised px-3.5 py-2 text-sm text-foreground"
                  : `max-w-[92%] rounded-2xl rounded-bl-sm border px-3.5 py-2 text-sm leading-relaxed ${
                      t.refused ? "border-danger/40 bg-danger-soft" : "border-line bg-background"
                    }`
              }
            >
              <p>{t.text}</p>
              {t.outcome && (
                <p className={`mt-2 text-xs font-medium ${t.refused ? "text-danger" : "text-accent"}`}>{t.outcome}</p>
              )}
            </div>
          </div>
        ))}
        {sending && <p className="text-xs text-muted">Drafting…</p>}
        <div ref={bottomRef} />
      </div>

      {lastDraft && (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted">Copy to seller</span>
            <button
              type="button"
              onClick={() => void copyDraft(lastDraft)}
              className="rounded border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-foreground"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-background px-3 py-2 text-xs leading-relaxed text-foreground">
            {lastDraft}
          </pre>
        </div>
      )}

      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={orders.length === 0 ? "Approve an order first" : "I want to return this / the zip is broken"}
          disabled={sending}
          className="min-w-0 flex-1 rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || input.trim().length === 0}
          className="rounded-md border border-line bg-panel-raised px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </aside>
  );
}
