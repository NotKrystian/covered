"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { OrderRecord } from "@/lib/memory";
import { formatPence } from "@/lib/money";
import { AppHeader } from "@/components/AppHeader";
import { OrderSheet } from "@/components/OrderSheet";
import { returnStatus, switchOfferFor } from "@/lib/returns";
import { lessByPence } from "@/lib/switch-rule";

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
  /** Order whose returns popup is open. */
  const [sheetId, setSheetId] = useState<string | null>(null);
  /** Last return or request, shown above the table so it is visible after the popup closes. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Row whose order id, query and section are shown (one at a time). */
  const [detailsId, setDetailsId] = useState<string | null>(null);
  /** Signs the return email. */
  const [buyerName, setBuyerName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ordersRes, walletRes] = await Promise.all([fetch("/api/orders"), fetch("/api/wallet")]);
      if (ordersRes.ok) {
        const json = (await ordersRes.json()) as OrdersResponse;
        setOrders(json.orders);
        setTotalPence(json.total_pence);
        setCount(json.count);
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
    // A price-drop banner links here as /orders?return=<order id>: open that order's popup.
    const target = new URLSearchParams(window.location.search).get("return");
    void refresh().then(() => {
      if (!target) return;
      setSheetId(target);
      window.history.replaceState(null, "", "/orders");
    });
    fetch("/api/memory")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { memory?: { display_name?: string } } | null) => setBuyerName(json?.memory?.display_name ?? null))
      .catch(() => undefined);
  }, [refresh]);

  const sheetOrder = sheetId ? orders.find((o) => o.id === sheetId) ?? null : null;

  return (
    <div className="min-h-full bg-background text-foreground">
      <AppHeader balancePence={balancePence} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Approved orders</h1>
            <p className="mt-1 text-sm text-muted">
              Click an order to return it or report a fault. Covered knows which of your rights still apply.
            </p>
          </div>
          <div className="tnum text-sm text-muted">
            {count} order{count === 1 ? "" : "s"} · {formatPence(totalPence)} spent
          </div>
        </div>
        {notice && (
          <p className="mb-6 rounded-xl border border-accent/40 bg-accent-soft px-5 py-3 text-sm">✓ {notice}</p>
        )}
        <div>
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
                      <th className="px-4 py-2 font-medium">Title</th>
                      <th className="px-4 py-2 font-medium">Merchant</th>
                      <th className="px-4 py-2 text-right font-medium">Price</th>
                      <th className="px-4 py-2">
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {orders.map((o) => {
                      const open = detailsId === o.id;
                      const offer = switchOfferFor(o);
                      const status = offer
                        ? `found for ${formatPence(lessByPence(o, offer))} less`
                        : returnStatus(o);
                      const rowTone = "bg-background hover:bg-panel-raised";
                      return (
                        <Fragment key={o.id}>
                          <tr
                            className={`cursor-pointer ${rowTone}`}
                            onClick={() => setSheetId(o.id)}
                            title="Return it or report a fault"
                          >
                            <td className="tnum whitespace-nowrap px-4 py-2.5 text-muted">{when(o.t)}</td>
                            {/* w-full + max-w-0: the title takes whatever width is left and truncates. */}
                            <td className="w-full max-w-0 truncate px-4 py-2.5" title={o.title}>
                              {o.cancelled_at ? (
                                <span className="text-muted">
                                  <span className="line-through">{o.title}</span> · {status}
                                </span>
                              ) : (
                                <>
                                  {o.title}
                                  {status && <span className={offer ? "text-accent" : "text-muted"}> · {status}</span>}
                                </>
                              )}
                            </td>
                            <td className="max-w-[10rem] truncate px-4 py-2.5 text-muted" title={o.merchant}>
                              {o.merchant}
                            </td>
                            <td className="tnum px-4 py-2.5 text-right font-semibold">{formatPence(o.price_pence)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                aria-expanded={open}
                                onClick={(e) => {
                                  e.stopPropagation(); // details only; do not open the returns popup
                                  setDetailsId(open ? null : o.id);
                                }}
                                className="text-xs text-muted hover:text-foreground"
                              >
                                {open ? "Hide" : "Details"}
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr className={rowTone}>
                              <td colSpan={5} className="px-4 pb-3 pt-0">
                                <dl className="grid gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-[auto_minmax(0,1fr)]">
                                  <dt>Order</dt>
                                  <dd className="truncate font-mono text-foreground" title={o.id}>
                                    {o.id}
                                  </dd>
                                  <dt>Query</dt>
                                  <dd className="truncate text-foreground" title={o.query}>
                                    {o.query}
                                  </dd>
                                  <dt>Section</dt>
                                  <dd className="text-foreground">{o.section}</dd>
                                </dl>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
      {sheetOrder && (
        <OrderSheet
          order={sheetOrder}
          buyerName={buyerName}
          onClose={() => setSheetId(null)}
          onDone={(balance, message) => {
            setBalancePence(balance);
            setNotice(message);
            void refresh(); // the returned order, a rebought one, and the net "spent" total
          }}
        />
      )}
    </div>
  );
}
