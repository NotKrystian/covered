"use client";

import { MAX_PROTECTION_PREMIUM_BPS } from "@/lib/types";

const STEP_BPS = 100;
const MAX_PERCENT = MAX_PROTECTION_PREMIUM_BPS / 100;

function Chevron({ up, large }: { up: boolean; large: boolean }) {
  return (
    <svg
      viewBox="0 0 8 5"
      aria-hidden="true"
      className={`${large ? "h-[7px] w-3" : "h-[5px] w-2"} ${up ? "" : "rotate-180"}`}
    >
      <path d="M1 4l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STEP_BUTTON =
  "flex flex-1 items-center justify-center text-muted hover:bg-line hover:text-foreground active:text-accent disabled:pointer-events-none disabled:opacity-30";

type Props = {
  bps: number;
  onBps: (bps: number) => void;
  onEnter?: () => void;
  label: string;
  /** Wider field for onboarding. */
  large?: boolean;
};

function clampBps(bps: number): number {
  const stepped = Math.round(bps / STEP_BPS) * STEP_BPS;
  return Math.min(MAX_PROTECTION_PREMIUM_BPS, Math.max(0, stepped));
}

export function PercentField({ bps, onBps, onEnter, label, large = false }: Props) {
  const step = (dir: 1 | -1) => onBps(clampBps(bps + dir * STEP_BPS));
  return (
    <span
      className={`inline-flex items-center overflow-hidden rounded-md border border-line bg-panel-raised text-foreground focus-within:border-accent ${
        large ? "text-lg" : ""
      }`}
    >
      <input
        aria-label={label}
        type="number"
        min={0}
        max={MAX_PERCENT}
        step={1}
        value={Math.round(bps / 100)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onBps(clampBps(n * 100));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter?.();
        }}
        className={`tnum bg-transparent font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
          large ? "w-14 py-2 pr-1 pl-3 text-right text-xl" : "w-8 py-0.5 pr-0.5 pl-1.5 text-right"
        }`}
      />
      <span className={large ? "pr-2 text-muted" : "pr-1.5 text-muted"}>%</span>
      <span className="flex flex-col self-stretch border-l border-line">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label}, 1% more`}
          onClick={() => step(1)}
          disabled={bps >= MAX_PROTECTION_PREMIUM_BPS}
          className={`${STEP_BUTTON} ${large ? "px-2.5" : "px-1"}`}
        >
          <Chevron up large={large} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label}, 1% less`}
          onClick={() => step(-1)}
          disabled={bps <= 0}
          className={`${STEP_BUTTON} ${large ? "px-2.5" : "px-1"}`}
        >
          <Chevron up={false} large={large} />
        </button>
      </span>
    </span>
  );
}
