"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPence } from "@/lib/money";
import { demoDropPending, lessByPence, switchLastDayLabel } from "@/lib/switch-rule";
import { checkSwitchNow, watchSwitches, type SwitchWatch } from "@/lib/client/switch";

/** How often the open dashboard asks whether a watched price moved (demo cadence). */
const WATCH_EVERY_MS = 10_000;

type Props = {
  watches: SwitchWatch[];
  /** Fresh watch list from the price watcher. */
  onWatches: (watches: SwitchWatch[]) => void;
  /** Re-fetch the watch list (after a check). */
  onRefresh: () => Promise<void>;
};

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** A find sends you to that order's returns popup on /orders. */
function returnHref(orderId: string): string {
  return `/orders?return=${encodeURIComponent(orderId)}`;
}

function DemoTag() {
  return (
    <span
      className="rounded-full border border-line px-1.5 py-px text-[10px] font-normal uppercase tracking-wide text-muted"
      title="Demo market: the shop's price cut is staged. The judge, the switch rule and the refund are real."
    >
      demo
    </span>
  );
}

/**
 * The 14-day price-drop watch, one row per recent order. A find is a UK business with
 * the same item for less, after delivery and return postage; it links to the order's
 * returns popup, where the buyer sends the cancellation and buys it again. While a price
 * may still move, the list watches in the background and drops a banner from the top
 * when a find reaches the buyer's switch minimum.
 */
export function SwitchWatchList({ watches, onWatches, onRefresh }: Props) {
  const [busy, setBusy] = useState<Record<string, boolean | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  /** Orders whose price just dropped: shown in the banner until dismissed. */
  const [alertIds, setAlertIds] = useState<string[]>([]);

  // The price watcher: while a watched order's price may still move, ask the server
  // every few seconds. It only judges when something moved; a find raises the banner.
  const awaitingMove = watches.some((watch) => watch.watching && demoDropPending(watch.order));
  useEffect(() => {
    if (!awaitingMove) return;
    let inFlight = false;
    const tick = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const next = await watchSwitches();
      inFlight = false;
      if (!next) return;
      onWatches(next.watches);
      if (next.found.length > 0) setAlertIds((ids) => [...new Set([...next.found, ...ids])]);
    };
    const timer = window.setInterval(() => void tick(), WATCH_EVERY_MS);
    void tick();
    return () => window.clearInterval(timer);
  }, [awaitingMove, onWatches]);

  // A private or overseas order can never be switched, so it is not on the watch at all.
  const listed = watches.filter((watch) => !watch.blocked);
  if (listed.length === 0) return null;

  const checkNow = async (watch: SwitchWatch) => {
    const id = watch.order.id;
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => ({ ...e, [id]: undefined }));
    const result = await checkSwitchNow(watch.order);
    if (!result.ok) setErrors((e) => ({ ...e, [id]: result.error }));
    await onRefresh();
    setBusy((b) => ({ ...b, [id]: undefined }));
  };

  const offerFor = (watch: SwitchWatch) => watch.order.switch_check?.offer ?? null;
  const alerts = alertIds
    .map((id) => watches.find((w) => w.order.id === id && w.watching && offerFor(w)))
    .filter((w): w is SwitchWatch => w !== undefined);
  const lead = alerts[0];
  const leadOffer = lead ? offerFor(lead) : null;

  return (
    <section className="mt-8">
      {lead && leadOffer && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-3">
          <div
            role="status"
            aria-live="polite"
            className="banner-down pointer-events-auto flex w-full max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-accent/40 bg-panel px-5 py-3 shadow-2xl"
          >
            <div className="min-w-0 flex-1 basis-56">
              <p className="flex items-center gap-2 text-sm font-semibold">
                {alerts.length > 1 ? `${alerts.length} price drops found` : "Price drop found"}
                {leadOffer.simulated && <DemoTag />}
              </p>
              <p className="truncate text-sm text-muted" title={lead.order.title}>
                <span className="text-foreground">
                  {formatPence(lessByPence(lead.order, leadOffer))} less at {leadOffer.merchant}
                </span>{" "}
                · {lead.order.title}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={returnHref(lead.order.id)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background hover:brightness-110"
              >
                Start return
              </Link>
              <button
                type="button"
                onClick={() => setAlertIds([])}
                aria-label="Dismiss"
                className="rounded px-1.5 text-muted hover:text-foreground"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">14-day price-drop watch</h2>
        <p className="text-xs text-muted">
          Only UK shops that keep your rights, after return postage. Counted from your order date; your legal window
          runs from delivery, so it is never shorter.
        </p>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-panel">
        {listed.map((watch) => {
          const { order } = watch;
          const offer = offerFor(watch);
          const check = order.switch_check;
          const working = busy[order.id];
          if (!watch.watching) {
            return (
              <li key={order.id} className="px-4 py-3 text-sm text-muted">
                <p className="truncate">
                  <span className="line-through decoration-line">{order.title}</span>
                </p>
                <p className="mt-0.5 text-xs">
                  {order.merchant} {formatPence(order.price_pence)} · {order.switched_to ? "switched" : "returned"}
                  {order.refund_pence !== undefined ? ` · refunded ${formatPence(order.refund_pence)}` : ""}
                </p>
              </li>
            );
          }
          return (
            <li key={order.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{order.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {order.merchant} · paid {formatPence(order.price_pence)} · watching until{" "}
                    {switchLastDayLabel(watch.ends_at)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {!check
                      ? "Watching the price"
                      : offer
                        ? `Checked ${clock(check.checked_at)}`
                        : `Checked ${clock(check.checked_at)} · ${check.note}`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(working)}
                  onClick={() => void checkNow(watch)}
                  className="shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-50"
                >
                  {working ? "Checking…" : "Check now"}
                </button>
              </div>
              {offer && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span>
                      Found for <span className="tnum text-accent">{formatPence(lessByPence(order, offer))}</span> less
                      at {offer.merchant}
                    </span>
                    {offer.simulated && <DemoTag />}
                  </p>
                  <Link
                    href={returnHref(order.id)}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:brightness-110"
                  >
                    Return
                  </Link>
                </div>
              )}
              {errors[order.id] && <p className="mt-2 text-xs text-danger">{errors[order.id]}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
