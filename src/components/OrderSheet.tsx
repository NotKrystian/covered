"use client";

import { useEffect, useRef, useState } from "react";
import type { OrderRecord, SwitchOffer } from "@/lib/memory";
import { formatPence } from "@/lib/money";
import { lessByPence, returnPostagePence } from "@/lib/switch-rule";
import { acceptSwitch } from "@/lib/client/switch";
import {
  returnEmail,
  returnState,
  sendBackBy,
  switchOfferFor,
  type EmailKind,
  type ReturnOption,
} from "@/lib/returns";

type Props = {
  order: OrderRecord;
  /** Signs the email. */
  buyerName: string | null;
  onClose: () => void;
  /** After the email is sent: the wallet balance and one line for the page. */
  onDone: (balancePence: number, message: string) => void;
};

/** Backdrop clicks are ignored this long after the content changes, so a double-click never closes the sheet. */
const BACKDROP_GRACE_MS = 800;

/** What the buyer picked: a return path, or a switch (cancel, then buy the cheaper listing). */
type Choice = { kind: "switch"; offer: SwitchOffer } | { kind: "option"; option: ReturnOption };

type Done = { headline: string; lines: string[] };

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function emailKind(choice: Choice): EmailKind {
  return choice.kind === "switch" ? "switch" : choice.option.kind;
}

function PaperPlane() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

/**
 * Click an order, get this sheet: what you are entitled to right now. Picking a path
 * shows the email Covered writes to the shop; Send records it on the order, refunds the
 * demo wallet and, for a switch, buys the cheaper listing. Demo: no email leaves Covered.
 */
export function OrderSheet({ order, buyerName, onClose, onDone }: Props) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  /** Height held while the content swaps, so nothing moves under the cursor. */
  const [holdHeight, setHoldHeight] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  /** True for a moment after each swap; the backdrop ignores clicks while it is. */
  const shielded = useRef(false);
  const shieldTimer = useRef<number | undefined>(undefined);
  const state = returnState(order);
  const offer = done ? null : switchOfferFor(order);

  const shieldBackdrop = () => {
    shielded.current = true;
    window.clearTimeout(shieldTimer.current);
    shieldTimer.current = window.setTimeout(() => {
      shielded.current = false;
    }, BACKDROP_GRACE_MS);
  };

  useEffect(() => () => window.clearTimeout(shieldTimer.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  /** Swap the content without letting the sheet shrink under the cursor. */
  const swap = (apply: () => void) => {
    setHoldHeight(dialogRef.current?.offsetHeight ?? null);
    shieldBackdrop();
    setError(null);
    apply();
  };

  const send = async () => {
    if (!choice) return;
    shieldBackdrop();
    setSending(true);
    setError(null);
    try {
      const refundBy = sendBackBy(new Date().toISOString());
      if (choice.kind === "switch") {
        const result = await acceptSwitch(order.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const bought = `${choice.offer.merchant} at ${formatPence(choice.offer.price_pence)}`;
        swap(() =>
          setDone({
            headline: `✓ Sent to ${order.merchant}`,
            lines: [
              `${formatPence(result.refund_pence)} is back in your demo wallet. Post it back by ${refundBy}.`,
              `Bought it again from ${bought}. You kept ${formatPence(result.clear_pence)}.`,
            ],
          }),
        );
        onDone(
          result.balance_pence,
          `Returned "${order.title}" and bought it again from ${bought}. You kept ${formatPence(result.clear_pence)}.`,
        );
        return;
      }

      const { option } = choice;
      const res = await fetch("/api/orders/return", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: order.id, kind: option.kind }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; balance_pence: number }
        | { ok: false; error: string }
        | null;
      if (!json || !json.ok) {
        setError(json && !json.ok ? json.error : `That did not go through (${res.status}).`);
        return;
      }
      const refund = option.refund_pence;
      const outcome =
        refund === null
          ? `${option.kind === "replace" ? "Replacement" : "Repair"} requested.`
          : option.kind === "fault_refund"
            ? `${formatPence(refund)} is back in your demo wallet. Faulty, so they pay the postage.`
            : `${formatPence(refund)} is back in your demo wallet. Post it back by ${refundBy}.`;
      swap(() => setDone({ headline: `✓ Sent to ${order.merchant}`, lines: [outcome] }));
      onDone(
        json.balance_pence,
        refund === null
          ? `${option.kind === "replace" ? "Replacement" : "Repair"} requested from ${order.merchant} for "${order.title}".`
          : `Returned "${order.title}": ${formatPence(refund)} is back in your demo wallet.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not go through.");
    } finally {
      setSending(false);
    }
  };

  const primary = state.kind === "open" ? state.options.find((o) => o.kind === "return") : undefined;
  const faultOptions = state.kind === "open" ? state.options.filter((o) => o.kind !== "return") : [];
  const email = choice ? returnEmail(order, emailKind(choice), buyerName) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-[2px]"
      onClick={() => {
        if (!sending && !shielded.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-sheet-title"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          // The second click of a double-click lands on the new view: do not select a word there.
          if (shielded.current && e.detail > 1) e.preventDefault();
        }}
        style={holdHeight ? { minHeight: holdHeight } : undefined}
        className="sheet-up mx-4 mb-6 flex max-h-[calc(100dvh-3rem)] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">Covered</span>
            <span className="rounded-full border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
              returns
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Close"
            className="rounded px-1.5 text-muted hover:text-foreground disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted">
              {order.merchant} · bought {day(order.t)}
            </p>
            <p id="order-sheet-title" className="truncate text-sm font-medium" title={order.title}>
              {order.title}
            </p>
          </div>
          <p className="tnum shrink-0 text-2xl font-semibold">{formatPence(order.price_pence)}</p>
        </div>

        <div className="mt-4 flex flex-1 flex-col border-t border-line pt-4">
          {done ? (
            <div className="flex flex-1 flex-col gap-3">
              <div className="rounded-lg border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
                <p className="font-medium">{done.headline}</p>
                {done.lines.map((line) => (
                  <p key={line} className="mt-1 text-muted">
                    {line}
                  </p>
                ))}
              </div>
              <p className="text-xs text-muted">Demo: Covered keeps the email on this order; it is not delivered.</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-auto w-full rounded-lg border border-line py-2.5 text-sm font-medium hover:border-accent"
              >
                Done
              </button>
            </div>
          ) : choice && email ? (
            <div className="flex flex-1 flex-col gap-3">
              <div className="rounded-lg border border-line bg-background">
                <dl className="space-y-1 border-b border-line px-4 py-2.5 text-xs">
                  <div className="flex gap-3">
                    <dt className="w-14 shrink-0 text-muted">To</dt>
                    <dd>{email.to}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-14 shrink-0 text-muted">Subject</dt>
                    <dd className="min-w-0 truncate" title={email.subject}>
                      {email.subject}
                    </dd>
                  </div>
                </dl>
                <p className="max-h-64 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">
                  {email.body}
                </p>
              </div>
              {choice.kind === "switch" && (
                <p className="text-xs text-muted">
                  Once it is sent, Covered buys it again from {choice.offer.merchant} for{" "}
                  {formatPence(choice.offer.price_pence)} from your demo wallet. You keep{" "}
                  {formatPence(choice.offer.clear_pence)}.
                </p>
              )}
              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="mt-auto flex gap-2">
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => swap(() => setChoice(null))}
                  className="rounded-lg border border-line px-4 py-2.5 text-sm hover:border-accent disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void send()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-60"
                >
                  {sending ? "Sending…" : "Send"}
                  <PaperPlane />
                </button>
              </div>
            </div>
          ) : state.kind !== "open" ? (
            <p className="text-sm leading-relaxed text-muted">{state.note}</p>
          ) : (
            <div className="space-y-4">
              {state.note && <p className="text-sm text-muted">{state.note}</p>}
              {offer && (
                <div className="rounded-lg border border-accent/40 bg-accent-soft p-3">
                  <p className="text-sm font-medium">
                    Found for <span className="tnum text-accent">{formatPence(lessByPence(order, offer))}</span> less at{" "}
                    {offer.merchant}
                  </p>
                  <button
                    type="button"
                    onClick={() => swap(() => setChoice({ kind: "switch", offer }))}
                    className="mt-2 w-full rounded-lg bg-accent px-4 py-3 text-left text-background hover:brightness-110"
                  >
                    <span className="block font-semibold">
                      Return it and buy it again for {formatPence(offer.price_pence)}
                    </span>
                    <span className="block text-xs opacity-80">
                      You keep {formatPence(offer.clear_pence)} ·{" "}
                      {returnPostagePence(order) > 0
                        ? `after est. ${formatPence(returnPostagePence(order))} return postage`
                        : "free returns"}
                    </span>
                  </button>
                </div>
              )}
              {primary && (
                <button
                  type="button"
                  onClick={() => swap(() => setChoice({ kind: "option", option: primary }))}
                  className={
                    offer
                      ? "w-full rounded-lg border border-line px-4 py-2.5 text-left text-sm hover:border-accent"
                      : "w-full rounded-lg bg-accent px-4 py-3 text-left text-background hover:brightness-110"
                  }
                >
                  <span className={offer ? "block" : "block font-semibold"}>{primary.label}</span>
                  <span className={offer ? "block text-xs text-muted" : "block text-xs opacity-80"}>
                    {primary.right} ·{" "}
                    {primary.postage_pence > 0
                      ? `est. ${formatPence(primary.postage_pence)} return postage on you`
                      : "free returns"}
                  </span>
                </button>
              )}
              <div>
                <p className="text-sm font-medium">Something wrong with it?</p>
                <p className="mt-0.5 text-xs text-muted">Only if it is actually faulty. Changed your mind is a return, not a fault.</p>
                <div className="mt-2 grid gap-2">
                  {faultOptions.map((option) => (
                    <button
                      key={option.kind}
                      type="button"
                      onClick={() => swap(() => setChoice({ kind: "option", option }))}
                      className="rounded-lg border border-line px-4 py-2.5 text-left text-sm hover:border-accent"
                    >
                      <span className="block">{option.label}</span>
                      <span className="block text-xs text-muted">{option.right}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
