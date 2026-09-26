"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { OrderRecord } from "@/lib/memory";
import { formatPence } from "@/lib/money";
import { WalletStrip } from "@/components/WalletStrip";
import { AftercareChat } from "@/components/AftercareChat";

type OrdersResponse = {
  orders: OrderRecord[];
  total_pence: number;
  count: number;
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [totalPence, setTotalPence] = useState(0);
  const [count, setCount] = useState(0);
  const [balancePence, setBalancePence] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ordersRes, walletRes] = await Promise.all([fetch("/api/orders"), fetch("/api/wallet")]);
      if (ordersRes.ok) {
        const json = (await ordersRes.json()) as OrdersResponse;
        setOrders(json.orders);
        setTotalPence(json.total_pence);
        setCount(json.count);
        setSelectedId((current) => current ?? json.orders[0]?.id ?? null);
      }
      if (walletRes.ok) {
        const json = (await walletRes.json()) as { ok?: boolean; balance_pence?: number };
        if (typeof json.balance_pence === "number") setBalancePence(json.balance_pence);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel px-5 py-2.5 text-sm">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="font-semibold tracking-tight text-foreground">
            Covered
          </Link>
          <span className="text-accent">Orders</span>
          <span className="text-muted">
            buys the cheapest listing that is actually the item and still has your rights
          </span>
        </div>
        <WalletStrip compact balancePence={balancePence} onBalance={setBalancePence} />
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Approved orders</h1>
            <p className="mt-1 text-sm text-muted">Receipts this browser has approved. Approve spends the bot wallet.</p>
          </div>
          <div className="tnum text-sm text-muted">
            {count} order{count === 1 ? "" : "s"} · {formatPence(totalPence)} spent
          </div>
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div>
            {loading ? (
              <p className="text-sm text-muted">Loading orders…</p>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted">No approved orders yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="bg-panel text-[11px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium">Order</th>
                      <th className="px-4 py-2 font-medium">Query</th>
                      <th className="px-4 py-2 font-medium">Title</th>
                      <th className="px-4 py-2 font-medium">Merchant</th>
                      <th className="px-4 py-2 font-medium">Section</th>
                      <th className="px-4 py-2 text-right font-medium">Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {orders.map((o) => (
                      <tr
                        key={o.id}
                        className={`cursor-pointer ${o.id === selectedId ? "bg-accent-soft" : "bg-background"}`}
                        onClick={() => setSelectedId(o.id)}
                      >
                        <td className="tnum whitespace-nowrap px-4 py-2.5 text-muted">{when(o.t)}</td>
                        <td className="max-w-[8rem] truncate px-4 py-2.5 font-mono text-xs text-muted" title={o.id}>
                          {o.id}
                        </td>
                        <td className="max-w-[12rem] truncate px-4 py-2.5 text-muted" title={o.query}>
                          {o.query}
                        </td>
                        <td className="max-w-[16rem] truncate px-4 py-2.5" title={o.title}>
                          {o.cancelled_at ? (
                            <span className="text-muted">
                              <span className="line-through">{o.title}</span> · switched
                            </span>
                          ) : (
                            o.title
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted">{o.merchant}</td>
                        <td className="px-4 py-2.5 text-muted">{o.section}</td>
                        <td className="tnum px-4 py-2.5 text-right font-semibold">{formatPence(o.price_pence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <AftercareChat orders={orders} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <p className="mt-6 text-xs text-muted">
          <Link href="/" className="text-accent hover:underline">
            ← Back to the shop
          </Link>
        </p>
      </main>
    </div>
  );
}
