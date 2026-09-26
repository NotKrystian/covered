"use client";

import type { UserSettings } from "@/lib/types";

type Props = {
  settings: UserSettings;
  onChange: (next: UserSettings) => void;
  /** Optional display name, stored in preference memory. */
  displayName: string;
  onDisplayName: (name: string) => void;
  onRun: () => void;
  running: boolean;
};

function poundsToPence(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 8 5" aria-hidden="true" className={`h-[5px] w-2 ${up ? "" : "rotate-180"}`}>
      <path d="M1 4l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STEP_BUTTON =
  "flex flex-1 items-center justify-center px-1 text-muted hover:bg-line hover:text-foreground active:text-accent disabled:pointer-events-none disabled:opacity-30";

function PoundInput({
  pence,
  onPence,
  onEnter,
  label,
}: {
  pence: number;
  onPence: (p: number) => void;
  onEnter: () => void;
  label: string;
}) {
  const step = (dir: 1 | -1) => onPence(Math.max(0, pence + dir * 100));
  return (
    <span className="inline-flex items-center overflow-hidden rounded border border-line bg-panel-raised text-foreground focus-within:border-accent">
      <span className="pl-1.5 text-muted">£</span>
      <input
        aria-label={label}
        type="number"
        min={0}
        step={1}
        value={pence / 100}
        onChange={(e) => {
          const p = poundsToPence(e.target.value);
          if (p !== null) onPence(p);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter();
        }}
        // Native spinners hidden (Firefox: textfield; WebKit/Blink: spin-button pseudo-elements); the stepper below replaces them.
        className="tnum w-9 bg-transparent py-0.5 pr-1.5 pl-0.5 text-right font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {/* Keyboard users keep ArrowUp/ArrowDown in the input, so the buttons stay out of the tab order. */}
      <span className="flex flex-col self-stretch border-l border-line">
        <button type="button" tabIndex={-1} aria-label={`${label}, £1 more`} onClick={() => step(1)} className={STEP_BUTTON}>
          <Chevron up />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label}, £1 less`}
          onClick={() => step(-1)}
          disabled={pence <= 0}
          className={STEP_BUTTON}
        >
          <Chevron up={false} />
        </button>
      </span>
    </span>
  );
}

export function SettingsStrip({ settings, onChange, displayName, onDisplayName, onRun, running }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel px-5 py-2.5 text-sm">
      <div className="flex items-baseline gap-3">
        <span className="font-semibold tracking-tight text-foreground">Covered</span>
        <span className="text-muted">
          buys the cheapest listing that is actually the item and still has your rights
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-muted">
          I am
          <input
            aria-label="Your name (optional, kept in memory)"
            value={displayName}
            onChange={(e) => onDisplayName(e.target.value.slice(0, 40))}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRun();
            }}
            placeholder="name"
            className="w-20 rounded border border-line bg-panel-raised px-1.5 py-0.5 text-foreground outline-none placeholder:text-muted focus:border-accent"
          />
        </span>
        <span className="text-line">·</span>
        <span className="flex items-center gap-1.5 text-muted">
          Pay up to
          <PoundInput
            label="Protection premium in pounds"
            pence={settings.protection_premium_pence}
            onPence={(p) => onChange({ ...settings, protection_premium_pence: p })}
            onEnter={onRun}
          />
          more for rights
        </span>
        <span className="text-line">·</span>
        <span className="flex items-center gap-1.5 text-muted">
          Switch if I clear
          <PoundInput
            label="Switch minimum in pounds"
            pence={settings.switch_minimum_pence}
            onPence={(p) => onChange({ ...settings, switch_minimum_pence: p })}
            onEnter={onRun}
          />
        </span>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="rounded border border-line bg-panel-raised px-3 py-1 font-medium text-foreground hover:border-accent disabled:opacity-50"
        >
          {running ? "Running…" : "Re-run"}
        </button>
      </div>
    </header>
  );
}
