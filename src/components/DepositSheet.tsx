"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatPence } from "@/lib/money";
import { deviceKind, type DeviceKind } from "@/lib/client/device";
import { LoadingDots } from "@/components/LoadingDots";

type Props = {
  balancePence: number;
  onBalance: (pence: number) => void;
  onClose: () => void;
};

type WalletResponse = { ok: true; balance_pence: number } | { ok: false; error: string };

type MethodId = "card" | "apple_pay" | "google_pay" | "paypal" | "bank";
/** `only`: the one device kind that offers this method (phone wallets). */
type Method = { id: MethodId; name: string; detail: string; only?: DeviceKind };

/** Demo methods: each one tops up the same demo ledger. Nothing is charged anywhere. */
const METHODS: Method[] = [
  { id: "card", name: "Card", detail: "Visa •••• 4242" },
  { id: "apple_pay", name: "Apple Pay", detail: "On this iPhone or iPad", only: "ios" },
  { id: "google_pay", name: "Google Pay", detail: "On this Android phone", only: "android" },
  { id: "paypal", name: "PayPal", detail: "From your PayPal balance" },
  { id: "bank", name: "Bank transfer", detail: "Open Banking, approve in your bank app" },
];

/** Apple Pay only on iPhone and iPad, Google Pay only on Android, neither on a desktop. */
function methodsFor(device: DeviceKind): Method[] {
  return METHODS.filter((m) => m.only === undefined || m.only === device);
}

const PRESET_POUNDS = [10, 20, 50, 100];
/** POST /api/wallet takes at most £500 per deposit. */
const MAX_DEPOSIT_PENCE = 50_000;
/** Clicks this soon after the sheet opens are ignored: the tail of a double-click on Deposit. */
const ARM_MS = 500;
/** Per-viewer convenience: the method picked last time. */
const METHOD_KEY = "covered_deposit_method";

/** The method picked last time, if this device offers it; otherwise the card. */
function savedMethod(methods: Method[]): MethodId {
  try {
    const id = window.localStorage.getItem(METHOD_KEY);
    return methods.find((m) => m.id === id)?.id ?? "card";
  } catch {
    return "card";
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function MethodIcon({ id }: { id: MethodId }) {
  switch (id) {
    case "card":
      return (
        <Icon>
          <rect x="2.5" y="5" width="19" height="14" rx="2" />
          <path d="M2.5 10h19M6 15h4" />
        </Icon>
      );
    case "apple_pay":
    case "google_pay":
      return (
        <Icon>
          <rect x="6.5" y="2.5" width="11" height="19" rx="2" />
          <path d="M11 18h2" />
        </Icon>
      );
    case "paypal":
      return (
        <Icon>
          <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A2.5 2.5 0 0 0 3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
          <path d="M21 9h-5a3 3 0 0 0 0 6h5z" />
        </Icon>
      );
    case "bank":
      return (
        <Icon>
          <path d="M3 9.5 12 4l9 5.5M4.5 20h15M6 10.5V17M10 10.5V17M14 10.5V17M18 10.5V17" />
        </Icon>
      );
    default: {
      const unhandled: never = id;
      return unhandled;
    }
  }
}

/**
 * Top up the demo wallet: pick an amount and a payment method this device offers, then Add. Every
 * method lands in the same demo ledger (POST /api/wallet) and the sheet says plainly
 * that nothing is charged. Rendered into the body so a header never clips or covers it.
 */
export function DepositSheet({ balancePence, onBalance, onClose }: Props) {
  const [pounds, setPounds] = useState("20");
  // Rendered only after a click, so `navigator` is always there.
  const [methods] = useState(() => methodsFor(deviceKind(navigator)));
  const [method, setMethod] = useState<MethodId>(() => savedMethod(methods));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ pence: number; method: Method; balancePence: number } | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const armed = useRef(false);

  const amount = Number(pounds);
  const pence = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
  const valid = pence > 0 && pence <= MAX_DEPOSIT_PENCE;
  const chosen = methods.find((m) => m.id === method) ?? methods[0];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      armed.current = true;
    }, ARM_MS);
    addRef.current?.focus();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const pick = (id: MethodId) => {
    setMethod(id);
    try {
      window.localStorage.setItem(METHOD_KEY, id);
    } catch {
      // Remembering the method is a convenience only.
    }
  };

  const add = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_pence: pence }),
      });
      const json = (await res.json().catch(() => null)) as WalletResponse | null;
      if (!res.ok || !json || !json.ok) {
        setError(json && !json.ok ? json.error : `Deposit failed (${res.status})`);
        return;
      }
      onBalance(json.balance_pence);
      setDone({ pence, method: chosen, balancePence: json.balance_pence });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  };

  /** The tail of a double-click must not move focus or select text. */
  const holdFocus = (e: MouseEvent) => {
    if (!armed.current) e.preventDefault();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-[2px]"
      onMouseDown={holdFocus}
      onClick={() => {
        if (!busy && armed.current) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="sheet-up mx-4 mb-6 max-h-[calc(100dvh-3rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-line bg-panel p-6 text-sm shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">Covered</span>
            <span className="rounded-full border border-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">
              demo wallet
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="rounded px-1.5 text-muted hover:text-foreground disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-end justify-between gap-4">
          <h2 id="deposit-sheet-title" className="text-lg font-semibold tracking-tight">
            Add money
          </h2>
          <p className="text-muted">
            Balance <span className="tnum text-foreground">{formatPence(done?.balancePence ?? balancePence)}</span>
          </p>
        </div>

        {done ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-accent/40 bg-accent-soft px-4 py-3">
              <p className="font-medium">
                ✓ {formatPence(done.pence)} added with {done.method.name}
              </p>
              <p className="mt-1 text-muted">Your wallet now has {formatPence(done.balancePence)}.</p>
            </div>
            <button
              ref={doneRef}
              type="button"
              onClick={onClose}
              className="w-full rounded-lg border border-line py-2.5 font-medium outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Amount</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {PRESET_POUNDS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={amount === p}
                  onClick={() => setPounds(String(p))}
                  className={`tnum rounded-lg border py-2 font-semibold ${
                    amount === p ? "border-accent bg-accent-soft text-foreground" : "border-line hover:border-accent"
                  }`}
                >
                  £{p}
                </button>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-panel-raised px-3 py-2 focus-within:border-accent">
              <span className="text-muted">Other</span>
              <span className="ml-auto text-muted">£</span>
              <input
                aria-label="Deposit amount in pounds"
                type="number"
                min={1}
                max={MAX_DEPOSIT_PENCE / 100}
                step={1}
                value={pounds}
                onChange={(e) => setPounds(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void add();
                }}
                className="tnum w-20 bg-transparent text-right font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </label>
            {pence > MAX_DEPOSIT_PENCE && (
              <p className="mt-1 text-xs text-danger">Up to {formatPence(MAX_DEPOSIT_PENCE)} per deposit.</p>
            )}

            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">Pay with</p>
            <div role="radiogroup" aria-label="Payment method" className="mt-2 divide-y divide-line rounded-lg border border-line">
              {methods.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg has-[:checked]:bg-accent-soft"
                >
                  <MethodIcon id={m.id} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{m.name}</span>
                    <span className="block truncate text-xs text-muted">{m.detail}</span>
                  </span>
                  <input
                    type="radio"
                    name="deposit-method"
                    value={m.id}
                    checked={method === m.id}
                    onChange={() => pick(m.id)}
                    className="h-4 w-4 accent-accent"
                  />
                </label>
              ))}
            </div>

            {error && <p className="mt-3 text-danger">{error}</p>}

            <button
              ref={addRef}
              type="button"
              disabled={!valid || busy}
              onClick={() => void add()}
              className="mt-5 flex h-12 w-full items-center justify-center rounded-lg bg-accent font-semibold text-background outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel disabled:bg-panel-raised disabled:text-muted disabled:hover:brightness-100"
            >
              {busy ? (
                <>
                  Adding with {chosen.name}
                  <LoadingDots />
                </>
              ) : valid ? (
                `Add ${formatPence(pence)} with ${chosen.name}`
              ) : (
                "Enter an amount"
              )}
            </button>
            <p className="mt-2 text-center text-[11px] text-muted">
              Demo money only. No card, wallet or bank is charged.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
