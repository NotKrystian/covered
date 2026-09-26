"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { DEFAULT_USER_SETTINGS } from "@/lib/types";
import type { UserSettings } from "@/lib/types";
import { formatBps, formatPence } from "@/lib/money";
import { depositWallet, patchMemory, type MemoryState } from "@/lib/client/shop";
import { loadOnboarding, saveOnboarding } from "@/lib/client/onboarding-progress";
import { PercentField } from "@/components/PercentField";
import { PoundField } from "@/components/PoundField";

type Props = {
  onDone: (next: MemoryState, balancePence: number) => void;
};

const STEPS = 5;

export function Onboarding({ onDone }: Props) {
  // Resume where this browser left off (see onboarding-progress.ts).
  const [initial] = useState(() => loadOnboarding());
  const [step, setStep] = useState(() => Math.min(STEPS, initial?.step ?? 1));
  const [name, setName] = useState(initial?.name ?? "");
  const [settings, setSettings] = useState<UserSettings>(initial?.settings ?? DEFAULT_USER_SETTINGS);
  const [depositPounds, setDepositPounds] = useState(initial?.deposit ?? "20");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveOnboarding({ step, name, settings, deposit: depositPounds, done: false });
  }, [step, name, settings, depositPounds]);

  const next = () => setStep((s) => Math.min(STEPS, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  const finish = async (amountPence: number) => {
    setBusy(true);
    setError(null);
    const saved = await patchMemory({
      display_name: name.trim() || undefined,
      settings,
      onboarded: true,
    });
    if (!saved) {
      setBusy(false);
      setError("Could not save your preferences. Try again.");
      return;
    }
    let balance = saved.memory.balance_pence;
    if (amountPence > 0) {
      const deposited = await depositWallet(amountPence);
      if (!deposited.ok) {
        setBusy(false);
        setError(deposited.error);
        return;
      }
      balance = deposited.balance_pence;
    }
    setBusy(false);
    // Keep the answers so a lost server memory can be restored without asking again.
    saveOnboarding({ step, name, settings, deposit: depositPounds, done: true });
    onDone(saved, balance);
  };

  const saveWithDeposit = () => {
    const n = Number(depositPounds);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter an amount, or skip with £0.");
      return;
    }
    void finish(Math.round(n * 100));
  };

  // Enter continues from anywhere on the step (step 4 has no input). A focused button
  // or link keeps its own Enter so nothing fires twice.
  const onEnter = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.isComposing || e.repeat || busy) return;
    if (e.target instanceof HTMLElement && e.target.closest("button, a")) return;
    e.preventDefault();
    if (step < STEPS) next();
    else saveWithDeposit();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onEnter(e);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex min-h-full flex-col bg-background text-foreground">
      <header className="px-8 pt-10">
        <p className="text-sm font-semibold tracking-tight">Covered</p>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-8 py-16">
        <p className="mb-10 text-xs uppercase tracking-[0.2em] text-muted">
          {step} / {STEPS}
        </p>

        {step === 1 && (
          <section className="space-y-8">
            <h1 className="text-4xl font-semibold tracking-tight">What should it call you?</h1>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              placeholder="Your name"
              className="w-full border-b border-line bg-transparent py-3 text-2xl outline-none placeholder:text-muted focus:border-accent"
            />
          </section>
        )}

        {step === 2 && (
          <section className="space-y-8">
            <h1 className="text-4xl font-semibold tracking-tight">
              Pay up to {formatBps(settings.protection_premium_bps)} more to keep UK buyer rights
            </h1>
            <p className="text-muted">
              That&apos;s how far below a UK shop the cheaper listing can be before you take it.
            </p>
            <PercentField
              large
              label="Protection premium as a percent of the UK shop"
              bps={settings.protection_premium_bps}
              onBps={(bps) => setSettings({ ...settings, protection_premium_bps: bps })}
            />
          </section>
        )}

        {step === 3 && (
          <section className="space-y-8">
            <h1 className="text-4xl font-semibold tracking-tight">Inside 14 days, only switch if you clear this after postage</h1>
            <p className="text-muted">Default £8. A cheaper find has to beat this after you pay to send the first one back.</p>
            <p className="text-sm leading-relaxed text-muted">
              For 14 days after each order from a UK shop, Covered re-checks the price. It offers a switch only to a UK
              shop that keeps your rights, and only if you clear this after return postage.
            </p>
            <PoundField
              large
              label="Switch minimum in pounds"
              pence={settings.switch_minimum_pence}
              onPence={(p) => setSettings({ ...settings, switch_minimum_pence: p })}
            />
          </section>
        )}

        {step === 4 && (
          <section className="space-y-8">
            <h1 className="text-4xl font-semibold tracking-tight">In plain English</h1>
            <p className="text-lg leading-relaxed text-foreground">
              You will pay up to {formatBps(settings.protection_premium_bps)} more for a UK shop with real returns, and only move
              after delivery if a cheaper listing still clears {formatPence(settings.switch_minimum_pence)} once postage is paid.
            </p>
            <p className="text-lg leading-relaxed text-muted">
              If the cheapest fleece is a private seller at £28 and JD Sports has the same jacket at £36, that is 22% off the shop.
              Inside your {formatBps(settings.protection_premium_bps)}, Covered buys the shop so you keep 14-day cancellation and a
              30-day fault refund.
            </p>
          </section>
        )}

        {step === 5 && (
          <section className="space-y-8">
            <h1 className="text-4xl font-semibold tracking-tight">Deposit into the bot wallet</h1>
            <p className="text-muted">
              Approve spends this ledger. You can skip with £0 — Approve will not spend until there is money.
            </p>
            <label className="block text-sm text-muted">
              Amount
              <span className="mt-2 flex items-center overflow-hidden rounded-md border border-line bg-panel-raised text-foreground focus-within:border-accent">
                <span className="pl-3 text-muted">£</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={depositPounds}
                  onChange={(e) => setDepositPounds(e.target.value)}
                  className="tnum w-full bg-transparent px-2 py-3 text-xl font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </span>
            </label>
          </section>
        )}

        {error && <p className="mt-6 text-sm text-danger">{error}</p>}

        <div className="mt-16 flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={step === 1 || busy}
            className="text-sm text-muted hover:text-foreground disabled:opacity-0"
          >
            Back
          </button>
          {step < STEPS ? (
            <button
              type="button"
              onClick={next}
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-background hover:brightness-110"
            >
              Continue
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void finish(0)}
                className="rounded-md border border-line px-5 py-2.5 text-sm text-muted hover:text-foreground disabled:opacity-50"
              >
                Skip with £0
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={saveWithDeposit}
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save and continue"}
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
