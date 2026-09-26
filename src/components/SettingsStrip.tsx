"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { UserSettings } from "@/lib/types";
import { PoundField } from "@/components/PoundField";

type Props = {
  settings: UserSettings;
  onChange: (next: UserSettings) => void;
  /** Optional display name, stored in preference memory. */
  displayName: string;
  onDisplayName: (name: string) => void;
  onRun: () => void;
  running: boolean;
  wallet?: ReactNode;
};

export function SettingsStrip({ settings, onChange, displayName, onDisplayName, onRun, running, wallet }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-panel px-5 py-2.5 text-sm">
      <div className="flex items-baseline gap-3">
        <span className="font-semibold tracking-tight text-foreground">Covered</span>
        <Link href="/" className="text-muted hover:text-foreground">
          Home
        </Link>
        <Link href="/orders" className="text-muted hover:text-foreground">
          Orders
        </Link>
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
          <PoundField
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
          <PoundField
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
        {wallet && (
          <>
            <span className="text-line">·</span>
            {wallet}
          </>
        )}
      </div>
    </header>
  );
}
