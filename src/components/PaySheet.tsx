"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatPence } from "@/lib/money";

type Props = {
  merchant: string;
  title: string;
  /** Integer pence, or null when the listing price did not parse (then it cannot be paid). */
  pricePence: number | null;
  priceLabel: string;
  balancePence: number;
  /** Rights the judge listed for this pick, shown as what the money buys. */
  rights: string[];
  paying: boolean;
  error: string | null;
  onPay: () => void;
  onClose: () => void;
};

/** Two presses of Enter/Space inside this window count as the double-click. */
const DOUBLE_PRESS_MS = 600;

/**
 * Wallet payment sheet. It copies the phone gesture (double-click to confirm) but
 * carries no platform branding: the money comes from the Covered demo wallet and
 * no card is charged. Approve opens it; the parent performs the debit in `onPay`.
 */
export function PaySheet({
  merchant,
  title,
  pricePence,
  priceLabel,
  balancePence,
  rights,
  paying,
  error,
  onPay,
  onClose,
}: Props) {
  const targetRef = useRef<HTMLButtonElement | null>(null);
  const lastPress = useRef(0);
  const [hint, setHint] = useState(false);

  const shortBy = pricePence === null ? null : Math.max(0, pricePence - balancePence);
  const canPay = pricePence !== null && shortBy === 0 && !paying;

  const pay = useCallback(() => {
    if (canPay) onPay();
  }, [canPay, onPay]);

  useEffect(() => {
    targetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !paying) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, paying]);

  let targetLabel = "Double-click to pay";
  if (paying) targetLabel = "Paying from wallet…";
  else if (pricePence === null) targetLabel = "No price to pay";
  else if (shortBy !== null && shortBy > 0) targetLabel = "Not enough in the wallet";
  else if (hint) targetLabel = "Double-click to confirm";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-[2px]"
      onClick={() => {
        if (!paying) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="sheet-up mb-6 w-full max-w-sm rounded-2xl border border-line bg-panel p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span id="pay-sheet-title" className="font-semibold tracking-tight">
              Covered
            </span>
            <span className="rounded-full border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
              demo wallet
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={paying}
            aria-label="Close"
            className="rounded px-1.5 text-muted hover:text-foreground disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted">{merchant}</p>
            <p className="truncate text-sm font-medium">{title}</p>
          </div>
          <p className="tnum shrink-0 text-2xl font-semibold">{priceLabel}</p>
        </div>

        <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Pay from</dt>
            <dd>Covered demo wallet</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Balance</dt>
            <dd className="tnum">
              {formatPence(balancePence)}
              {pricePence !== null && shortBy === 0 && (
                <span className="text-muted"> → {formatPence(balancePence - pricePence)}</span>
              )}
            </dd>
          </div>
          {rights.length > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-muted">Keeps</dt>
              <dd className="text-right text-xs leading-5 text-muted">{rights.join(" · ")}</dd>
            </div>
          )}
        </dl>

        {shortBy !== null && shortBy > 0 && (
          <p className="mt-3 text-sm text-danger">
            Short by {formatPence(shortBy)}. Deposit into the wallet (top bar), then approve again.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <button
          ref={targetRef}
          type="button"
          disabled={!canPay}
          onClick={() => setHint(true)}
          onDoubleClick={pay}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            const now = Date.now();
            if (now - lastPress.current < DOUBLE_PRESS_MS) {
              lastPress.current = 0;
              pay();
            } else {
              lastPress.current = now;
              setHint(true);
            }
          }}
          className="relative mt-5 flex h-12 w-full select-none items-center justify-center rounded-xl border border-accent/50 bg-accent-soft font-semibold text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:border-line disabled:bg-panel-raised disabled:text-muted"
        >
          {targetLabel}
          {canPay && (
            // The side-button cue: a pulsing bar at the edge, like the phone's double-click prompt.
            <span aria-hidden="true" className="side-pulse absolute top-2 right-2 bottom-2 w-1 rounded-full bg-accent" />
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-muted">
          Demo money only. No card is charged. Keyboard: press Enter twice.
        </p>
      </div>
    </div>
  );
}
