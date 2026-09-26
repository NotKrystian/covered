"use client";

import { useState } from "react";
import { formatPence } from "@/lib/money";
import { DepositSheet } from "@/components/DepositSheet";

type Props = {
  balancePence: number;
  onBalance: (pence: number) => void;
  compact?: boolean;
};

/** Wallet balance plus Deposit, which opens the deposit popup (amount and payment method). */
export function WalletStrip({ balancePence, onBalance, compact = false }: Props) {
  const [depositing, setDepositing] = useState(false);

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2 text-xs" : "space-y-2 text-sm"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Wallet</span>
        <span className="tnum font-semibold text-foreground">{formatPence(balancePence)}</span>
        <button
          type="button"
          onClick={() => setDepositing(true)}
          className="rounded border border-line bg-panel-raised px-2 py-0.5 font-medium text-foreground hover:border-accent"
        >
          Deposit
        </button>
      </div>
      <p className="text-[11px] text-muted">Deposit into the bot wallet. Approve spends it.</p>
      {depositing && (
        <DepositSheet balancePence={balancePence} onBalance={onBalance} onClose={() => setDepositing(false)} />
      )}
    </div>
  );
}
