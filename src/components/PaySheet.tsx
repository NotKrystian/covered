"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { Decision } from "@/lib/types";
import { isProtected } from "@/lib/decision";
import { formatPence } from "@/lib/money";
import { DepositSheet } from "@/components/DepositSheet";

type Props = {
  merchant: string;
  title: string;
  /** Integer pence, or null when the listing price did not parse (then it cannot be paid). */
  pricePence: number | null;
  priceLabel: string;
  balancePence: number;
  /** Rights the judge listed for this pick, shown as what the money buys. */
  rights: string[];
  /** The judge's call on this pick. Anything short of a protected UK business is warned about first. */
  decision: Decision | null;
  paying: boolean;
  error: string | null;
  onPay: () => void;
  onClose: () => void;
  /** When set, a short wallet offers "Add money" here instead of sending the buyer away. */
  onBalance?: (pence: number) => void;
  /** The cheapest UK seller with this item, offered on the warning so the buyer can pay for the right to return. */
  alternative?: { merchant: string; priceLabel: string; extraPence: number; onChoose: () => void };
};

/** Two presses of Enter/Space inside this window count as the double-click. */
const DOUBLE_PRESS_MS = 600;
/** Clicks this soon after the sheet opens or changes step are ignored: the tail of a double-click. */
const ARM_MS = 500;

type SellerWarning = { title: string; lead: string; points: string[] };

const NO_WATCH = "Covered will not watch the price for 14 days or switch it.";

/** Why this pick is not a verified UK seller, or null when it is (see `isProtected`). */
function sellerWarning(merchant: string, decision: Decision | null): SellerWarning | null {
  if (decision && isProtected(decision)) return null;
  const seller = decision?.seller_type ?? "unclear";
  switch (seller) {
    case "private":
      return {
        title: "Private seller",
        lead: `${merchant} is a private seller, not a UK business.`,
        points: [
          "No 14-day cancellation: you cannot send it back because you changed your mind.",
          "No Consumer Rights Act refund, repair or replacement if it is faulty.",
          "You can only challenge a false description.",
          NO_WATCH,
        ],
      };
    case "overseas_business":
      return {
        title: "Overseas seller",
        lead: `${merchant} sells from outside the UK.`,
        points: [
          "UK consumer rights are hard to enforce abroad.",
          "Sending it back can mean international postage and customs charges.",
          NO_WATCH,
        ],
      };
    case "unclear":
      return {
        title: "Seller not verified",
        lead: `Covered could not confirm that ${merchant} is a UK business.`,
        points: ["Assume there is no 14-day cancellation and no fault refund.", NO_WATCH],
      };
    case "uk_business":
      return {
        title: "Unprotected checkout",
        lead: `${merchant} is a UK business, but this sale does not go through a protected checkout.`,
        points: ["If the seller stops answering, your rights are hard to enforce."],
      };
    default: {
      const unhandled: never = seller;
      return unhandled;
    }
  }
}

function WarningIcon() {
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
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * Wallet payment sheet. It copies the phone gesture (double-click to confirm) but
 * carries no platform branding: the money comes from the Covered demo wallet and
 * no card is charged. Approve opens it; the parent performs the debit in `onPay`.
 * A pick that is not a verified UK seller gets a warning first, and only
 * "Buy anyway" moves on to paying.
 */
export function PaySheet({
  merchant,
  title,
  pricePence,
  priceLabel,
  balancePence,
  rights,
  decision,
  paying,
  error,
  onPay,
  onClose,
  onBalance,
  alternative,
}: Props) {
  const targetRef = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const lastPress = useRef(0);
  const armed = useRef(false);
  const [hint, setHint] = useState(false);
  /** Short wallet: the deposit sheet opens on top, and paying carries on after it. */
  const [depositing, setDepositing] = useState(false);
  const warning = sellerWarning(merchant, decision);
  const [step, setStep] = useState<"warn" | "pay">(warning ? "warn" : "pay");

  const shortBy = pricePence === null ? null : Math.max(0, pricePence - balancePence);
  const canPay = pricePence !== null && shortBy === 0 && !paying;

  const pay = useCallback(() => {
    if (canPay) onPay();
  }, [canPay, onPay]);

  // Each step starts on its safe control ("Go back" on the warning) and ignores stray clicks briefly.
  useEffect(() => {
    armed.current = false;
    const timer = window.setTimeout(() => {
      armed.current = true;
    }, ARM_MS);
    (step === "warn" ? backRef : targetRef).current?.focus();
    return () => window.clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !paying && !depositing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, paying, depositing]);

  let targetLabel = "Double-click to pay";
  if (paying) targetLabel = "Paying from wallet…";
  else if (pricePence === null) targetLabel = "No price to pay";
  else if (shortBy !== null && shortBy > 0) targetLabel = "Not enough in the wallet";
  else if (hint) targetLabel = "Double-click to confirm";

  /** The tail of a double-click must not move focus off the safe control or select text. */
  const holdFocus = (e: MouseEvent) => {
    if (!armed.current) e.preventDefault();
  };

  if (step === "warn" && warning) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
        onMouseDown={holdFocus}
        onClick={() => {
          if (armed.current) onClose();
        }}
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="seller-warning-title"
          aria-describedby="seller-warning-lead"
          onClick={(e) => e.stopPropagation()}
          className="sheet-up mx-4 w-full max-w-sm rounded-2xl border border-danger/40 bg-panel p-6 shadow-2xl"
        >
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-danger">
            <WarningIcon />
            Not a verified UK seller
          </p>
          <h2 id="seller-warning-title" className="mt-3 text-lg font-semibold tracking-tight">
            {warning.title}
          </h2>
          <p id="seller-warning-lead" className="mt-1 text-sm text-muted">
            {warning.lead}
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {warning.points.map((point) => (
              <li key={point} className="flex gap-2">
                <span aria-hidden="true" className="text-danger">
                  ✕
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-baseline justify-between gap-4 rounded-lg border border-line px-3 py-2 text-sm">
            <span className="min-w-0 truncate text-muted" title={title}>
              {title}
            </span>
            <span className="tnum shrink-0 font-semibold">{priceLabel}</span>
          </div>
          {alternative && (
            <button
              type="button"
              onClick={() => {
                if (armed.current) alternative.onChoose();
              }}
              className="mt-4 w-full rounded-lg bg-accent px-4 py-3 text-left text-background outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
            >
              <span className="block font-semibold">
                Buy from {alternative.merchant} instead · {alternative.priceLabel}
              </span>
              <span className="block text-xs opacity-80">
                {alternative.extraPence > 0 ? `${formatPence(alternative.extraPence)} more, and you ` : "You "}
                can send it back: 14-day right to cancel and a 30-day fault refund
              </span>
            </button>
          )}
          <div className={alternative ? "mt-2 flex gap-2" : "mt-5 flex gap-2"}>
            <button
              ref={backRef}
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-line py-2.5 text-sm font-medium outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"
            >
              Go back
            </button>
            <button
              type="button"
              onClick={() => {
                if (armed.current) setStep("pay");
              }}
              className="flex-1 rounded-lg border border-danger/50 py-2.5 text-sm font-semibold text-danger outline-none hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-danger"
            >
              Buy anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-[2px]"
      onMouseDown={holdFocus}
      onClick={() => {
        if (!paying && armed.current) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="sheet-up mx-4 mb-6 w-full max-w-sm rounded-2xl border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span id="pay-sheet-title" className="text-sm font-semibold tracking-tight">
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
          {warning && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Seller</dt>
              <dd className="text-danger">{warning.title}</dd>
            </div>
          )}
          {rights.length > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-muted">Keeps</dt>
              <dd className="text-right text-xs leading-5 text-muted">{rights.join(" · ")}</dd>
            </div>
          )}
        </dl>

        {shortBy !== null && shortBy > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-danger">Short by {formatPence(shortBy)}.</p>
            {onBalance && (
              <button
                type="button"
                onClick={() => setDepositing(true)}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:border-accent"
              >
                Add money
              </button>
            )}
          </div>
        )}
        {depositing && onBalance && (
          <DepositSheet balancePence={balancePence} onBalance={onBalance} onClose={() => setDepositing(false)} />
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
          className="relative mt-5 flex h-12 w-full select-none items-center justify-center rounded-lg bg-accent font-semibold text-background outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:bg-panel-raised disabled:text-muted disabled:hover:brightness-100"
        >
          {targetLabel}
          {canPay && (
            // The side-button cue: a pulsing bar at the edge, like the phone's double-click prompt.
            <span aria-hidden="true" className="side-pulse absolute top-2 right-2 bottom-2 w-1 rounded-full bg-background/70" />
          )}
        </button>
        <p className="mt-2 text-center text-[11px] text-muted">
          Demo money only. No card is charged. Keyboard: press Enter twice.
        </p>
      </div>
    </div>
  );
}
