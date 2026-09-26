"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrderRecord } from "@/lib/memory";
import { formatPence } from "@/lib/money";
import { AppHeader } from "@/components/AppHeader";
import { DepositSheet } from "@/components/DepositSheet";

type WalletResponse = { ok: true; balance_pence: number; deposits: { t: string; amount_pence: number }[] };
type OrdersResponse = { orders: OrderRecord[] };

type Entry = { key: string; t: string; label: string; detail: string | null; pence: number };

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Money in and out of the demo wallet, newest first: deposits, purchases and refunds. */
function activity(deposits: WalletResponse["deposits"], orders: OrderRecord[]): Entry[] {
  const entries: Entry[] = [
    ...deposits.map((d, i) => ({ key: `d${i}-${d.t}`, t: d.t, label: "Deposit", detail: null, pence: d.amount_pence })),
    ...orders.map((o) => ({ key: `o-${o.id}`, t: o.t, label: o.merchant, detail: o.title, pence: -o.price_pence })),
    ...orders.flatMap((o) =>
      o.cancelled_at && o.refund_pence !== undefined
        ? [
            {
              key: `r-${o.id}`,
              t: o.cancelled_at,
              label: `Refund from ${o.merchant}`,
              detail: o.switched_to ? `Switched: ${o.title}` : o.title,
              pence: o.refund_pence,
            },
          ]
        : [],
    ),
  ];
  return entries.sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
}

/** The demo wallet: balance, Add money (the deposit sheet), and recent activity. */
export default function WalletPage() {
  const [balancePence, setBalancePence] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [depositing, setDepositing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [walletRes, ordersRes] = await Promise.all([fetch("/api/wallet"), fetch("/api/orders")]);
      const wallet = walletRes.ok ? ((await walletRes.json()) as WalletResponse) : null;
      const orders = ordersRes.ok ? ((await ordersRes.json()) as OrdersResponse).orders : [];
      if (wallet?.ok) setBalancePence(wallet.balance_pence);
      setEntries(activity(wallet?.ok ? wallet.deposits : [], orders));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="min-h-full bg-background text-foreground">
      <AppHeader balancePence={balancePence} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>

        <section className="mt-6 flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-line bg-panel p-6">
          <div>
            <p className="text-sm text-muted">Balance</p>
            <p className="tnum mt-1 text-4xl font-semibold tracking-tight">{formatPence(balancePence)}</p>
            <p className="mt-2 text-sm text-muted">Covered demo wallet. Approve spends it; refunds come back here.</p>
          </div>
          <button
            type="button"
            onClick={() => setDepositing(true)}
            className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-background hover:brightness-110"
          >
            Add money
          </button>
        </section>

        <h2 className="mt-10 text-sm font-semibold">Recent activity</h2>
        {loading ? (
          <p className="mt-3 text-sm text-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing yet. Add money, then approve a purchase.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-panel">
            {entries.map((entry) => (
              <li key={entry.key} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.label}</p>
                  <p className="truncate text-xs text-muted" title={entry.detail ?? undefined}>
                    {when(entry.t)}
                    {entry.detail ? ` · ${entry.detail}` : ""}
                  </p>
                </div>
                <p className={`tnum shrink-0 font-semibold ${entry.pence > 0 ? "text-accent" : ""}`}>
                  {entry.pence > 0 ? "+" : "−"}
                  {formatPence(Math.abs(entry.pence))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
      {depositing && (
        <DepositSheet
          balancePence={balancePence}
          onBalance={(pence) => {
            setBalancePence(pence);
            void refresh();
          }}
          onClose={() => setDepositing(false)}
        />
      )}
    </div>
  );
}
