"use client";

import { useState } from "react";
import { formatPence } from "@/lib/money";
import { acceptSwitch, checkSwitchNow, simulateSwitch, type SwitchWatch } from "@/lib/client/switch";
import { PaySheet } from "@/components/PaySheet";

type Props = {
  watches: SwitchWatch[];
  balancePence: number;
  onBalance: (pence: number) => void;
  /** Re-fetch the watch list (after a check, a simulation or a switch). */
  onRefresh: () => Promise<void>;
  /** One line for the page after a switch goes through. */
  onSwitched?: (message: string) => void;
};

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * The 14-day price-drop switch, one row per recent order. Covered moves the buyer
 * only when a UK business has the same item for less and the saving clears their
 * switch amount after return postage; the switch cancels the first order under the
 * cooling-off right and buys the new one from the demo wallet.
 */
export function SwitchWatchList({ watches, balancePence, onBalance, onRefresh, onSwitched }: Props) {
  const [busy, setBusy] = useState<Record<string, "check" | "simulate" | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [confirming, setConfirming] = useState<SwitchWatch | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  if (watches.length === 0) return null;

  const run = async (watch: SwitchWatch, kind: "check" | "simulate") => {
    const id = watch.order.id;
    setBusy((b) => ({ ...b, [id]: kind }));
    setErrors((e) => ({ ...e, [id]: undefined }));
    const result = kind === "check" ? await checkSwitchNow(watch.order) : await simulateSwitch(id);
    if (!result.ok) setErrors((e) => ({ ...e, [id]: result.error }));
    await onRefresh();
    setBusy((b) => ({ ...b, [id]: undefined }));
  };

  const offerFor = (watch: SwitchWatch) => watch.order.switch_check?.offer ?? null;
  const confirmOffer = confirming ? offerFor(confirming) : null;

  const confirmSwitch = async () => {
    if (!confirming || !confirmOffer) return;
    setSwitching(true);
    setSwitchError(null);
    const result = await acceptSwitch(confirming.order.id);
    setSwitching(false);
    if (!result.ok) {
      setSwitchError(result.error);
      return;
    }
    onBalance(result.balance_pence);
    onSwitched?.(
      `Switched: cancelled ${confirming.order.merchant} under your 14-day right and bought ${confirmOffer.merchant} at ${formatPence(confirmOffer.price_pence)}. You kept ${formatPence(result.clear_pence)}.`,
    );
    setConfirming(null);
    await onRefresh();
  };

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold">14-day price-drop watch</h2>
        <p className="text-xs text-muted">
          Moves you only to a UK shop that keeps your rights, and only if you clear your switch amount after return
          postage.
        </p>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-panel">
        {watches.map((watch) => {
          const { order } = watch;
          const offer = offerFor(watch);
          const check = order.switch_check;
          const working = busy[order.id];
          if (watch.blocked) {
            return (
              <li key={order.id} className="px-4 py-3 text-sm text-muted">
                <p className="truncate">{order.title}</p>
                <p className="mt-0.5 text-xs">
                  {order.merchant} · paid {formatPence(order.price_pence)} · no 14-day switch: {watch.blocked}
                </p>
              </li>
            );
          }
          if (!watch.watching) {
            return (
              <li key={order.id} className="px-4 py-3 text-sm text-muted">
                <p className="truncate">
                  <span className="line-through decoration-line">{order.title}</span>
                </p>
                <p className="mt-0.5 text-xs">
                  {order.merchant} {formatPence(order.price_pence)} · cancelled under the 14-day right
                  {order.refund_pence !== undefined ? ` · refunded ${formatPence(order.refund_pence)}` : ""}
                  {check?.note ? ` · ${check.note}` : ""}
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
                    {order.merchant} · paid {formatPence(order.price_pence)} · watching until {day(watch.ends_at)} ·{" "}
                    {watch.postage_pence > 0 ? `est. ${formatPence(watch.postage_pence)} return postage` : "free returns"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {check ? `Checked ${clock(check.checked_at)}: ${check.note}` : "Not checked yet"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    disabled={Boolean(working)}
                    onClick={() => void run(watch, "check")}
                    className="rounded-md border border-line px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-50"
                  >
                    {working === "check" ? "Checking…" : "Check now"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(working)}
                    onClick={() => void run(watch, "simulate")}
                    className="text-xs text-muted hover:text-foreground disabled:opacity-50"
                    title="Demo only: the same listing 35% cheaper, run through the real judge and switch rule"
                  >
                    {working === "simulate" ? "Simulating…" : "Simulate a price drop (demo)"}
                  </button>
                </div>
              </div>
              {offer && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2.5">
                  <p className="text-sm">
                    <span className="font-medium">Switch available</span>
                    {offer.simulated && (
                      <span className="ml-2 rounded-full border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
                        demo simulation
                      </span>
                    )}
                    <span className="block text-muted">
                      {offer.merchant} at {formatPence(offer.price_pence)}: you clear{" "}
                      <span className="tnum text-accent">{formatPence(offer.clear_pence)}</span>
                      {offer.postage_pence > 0 ? ` after ${formatPence(offer.postage_pence)} return postage` : " with free returns"}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSwitchError(null);
                      setConfirming(watch);
                    }}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:brightness-110"
                  >
                    Switch
                  </button>
                </div>
              )}
              {errors[order.id] && <p className="mt-2 text-xs text-danger">{errors[order.id]}</p>}
            </li>
          );
        })}
      </ul>
      {confirming && confirmOffer && (
        <PaySheet
          merchant={confirmOffer.merchant}
          title={confirmOffer.title}
          pricePence={confirmOffer.price_pence}
          priceLabel={formatPence(confirmOffer.price_pence)}
          balancePence={balancePence}
          rights={confirmOffer.decision.rights}
          paying={switching}
          error={switchError}
          action="switch"
          credit={{
            pence: Math.max(0, confirming.order.price_pence - confirmOffer.postage_pence),
            label: `${confirming.order.merchant} order, cancelled under the 14-day right`,
          }}
          onPay={() => void confirmSwitch()}
          onClose={() => setConfirming(null)}
        />
      )}
    </section>
  );
}
