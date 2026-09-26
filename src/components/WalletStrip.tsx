"use client";

import { useState } from "react";
import { formatPence } from "@/lib/money";

type Props = {
  balancePence: number;
  onBalance: (pence: number) => void;
  compact?: boolean;
};

type WalletResponse =
  | { ok: true; balance_pence: number }
  | { ok: false; error: string };

export function WalletStrip({ balancePence, onBalance, compact = false }: Props) {
  const [pounds, setPounds] = useState("20");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deposit = async () => {
    const n = Number(pounds);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a positive amount");
      return;
    }
    const amount_pence = Math.round(n * 100);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_pence }),
      });
      const json = (await res.json().catch(() => null)) as WalletResponse | null;
      if (!res.ok || !json || !json.ok) {
        setError(json && !json.ok ? json.error : `Deposit failed (${res.status})`);
        return;
      }
      onBalance(json.balance_pence);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2 text-xs" : "space-y-2 text-sm"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Wallet</span>
        <span className="tnum font-semibold text-foreground">{formatPence(balancePence)}</span>
        <span className="inline-flex items-center overflow-hidden rounded border border-line bg-panel-raised">
          <span className="pl-1.5 text-muted">£</span>
          <input
            aria-label="Deposit amount in pounds"
            type="number"
            min={1}
            step={1}
            value={pounds}
            onChange={(e) => setPounds(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void deposit();
            }}
            className="tnum w-14 bg-transparent py-0.5 pr-1.5 pl-0.5 text-right font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </span>
        <button
          type="button"
          onClick={() => void deposit()}
          disabled={busy}
          className="rounded border border-line bg-panel-raised px-2 py-0.5 font-medium text-foreground hover:border-accent disabled:opacity-50"
        >
          {busy ? "Depositing…" : "Deposit"}
        </button>
      </div>
      <p className="text-[11px] text-muted">Deposit into the bot wallet. Approve spends it.</p>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
