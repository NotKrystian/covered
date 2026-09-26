"use client";

import { useState } from "react";
import type { Limit } from "@/lib/memory";
import { formatPence } from "@/lib/money";
import { displayLimitStatus } from "@/lib/limit-status";

function poundsToPence(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function lastCheckedLabel(iso: string): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function statusClass(status: ReturnType<typeof displayLimitStatus>): string {
  switch (status) {
    case "filled":
      return "text-accent";
    case "wallet short":
      return "text-danger";
    case "paused":
    case "watching":
      return "text-muted";
    default: {
      const never: never = status;
      return never;
    }
  }
}

type EditorProps = {
  query: string;
  defaultPence: number | null;
  onConfirm: (pence: number) => Promise<void>;
  onCancel: () => void;
};

export function LimitEditor({ query, defaultPence, onConfirm, onCancel }: EditorProps) {
  const [pounds, setPounds] = useState(defaultPence === null ? "" : String(defaultPence / 100));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pence = poundsToPence(pounds);
  const canSave = Boolean(query.trim()) && pence !== null && !saving;

  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3 text-sm">
      <p className="text-muted">
        Buy <span className="text-foreground">{query.trim() || "this product"}</span> if a real listing is at or
        below
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center overflow-hidden rounded-md border border-line bg-panel-raised focus-within:border-accent">
          <span className="pl-2 text-muted">£</span>
          <input
            aria-label="Limit price in pounds"
            type="number"
            min={0}
            step={1}
            value={pounds}
            placeholder="max"
            onChange={(e) => setPounds(e.target.value)}
            className="tnum w-16 bg-transparent py-1 pr-2 pl-1 text-right font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => {
            if (pence === null) return;
            setSaving(true);
            setError(null);
            void onConfirm(pence)
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Could not save the limit");
              })
              .finally(() => setSaving(false));
          }}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Confirm"}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
      {!query.trim() && <p className="mt-2 text-xs text-muted">Type a product first.</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

type ListProps = {
  limits: Limit[];
  onRemove: (id: string) => void;
};

export function ActiveLimits({ limits, onRemove }: ListProps) {
  if (limits.length === 0) return null;
  return (
    <section className="mt-4" aria-label="Watching">
      <h2 className="text-sm font-semibold">Watching</h2>
      <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-panel">
        {limits.map((limit) => {
          const status = displayLimitStatus(limit);
          return (
            <li key={limit.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{limit.query}</p>
                <p className="mt-0.5 text-xs text-muted">
                  at or under {formatPence(limit.max_price_pence)}
                  <span className="mx-1.5 text-line">·</span>
                  <span className={statusClass(status)}>{status}</span>
                  {limit.last_result ? (
                    <>
                      <span className="mx-1.5 text-line">·</span>
                      {limit.last_result}
                    </>
                  ) : (
                    <>
                      <span className="mx-1.5 text-line">·</span>
                      last checked {lastCheckedLabel(limit.last_checked_at)}
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(limit.id)}
                className="shrink-0 text-xs text-muted hover:text-foreground"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
