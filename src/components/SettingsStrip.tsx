"use client";

import type { UserSettings } from "@/lib/types";

type Props = {
  settings: UserSettings;
  onChange: (next: UserSettings) => void;
  onRun: () => void;
  running: boolean;
};

function poundsToPence(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

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
  return (
    <span className="inline-flex items-baseline gap-0.5 rounded border border-line bg-panel-raised px-1.5 py-0.5 text-foreground">
      <span className="text-muted">£</span>
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
        className="tnum w-12 bg-transparent text-right font-semibold outline-none"
      />
    </span>
  );
}

export function SettingsStrip({ settings, onChange, onRun, running }: Props) {
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
