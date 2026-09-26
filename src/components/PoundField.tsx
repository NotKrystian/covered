"use client";

function poundsToPence(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

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
  pence: number;
  onPence: (p: number) => void;
  onEnter?: () => void;
  label: string;
  /** Wider field for onboarding. */
  large?: boolean;
};

export function PoundField({ pence, onPence, onEnter, label, large = false }: Props) {
  const step = (dir: 1 | -1) => onPence(Math.max(0, pence + dir * 100));
  return (
    <span
      className={`inline-flex items-center overflow-hidden rounded-md border border-line bg-panel-raised text-foreground focus-within:border-accent ${
        large ? "text-lg" : ""
      }`}
    >
      <span className={large ? "pl-3 text-muted" : "pl-1.5 text-muted"}>£</span>
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
          if (e.key === "Enter") onEnter?.();
        }}
        className={`tnum bg-transparent font-semibold outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
          large ? "w-16 py-2 pr-2 pl-1 text-right text-xl" : "w-9 py-0.5 pr-1.5 pl-0.5 text-right"
        }`}
      />
      <span className="flex flex-col self-stretch border-l border-line">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label}, £1 more`}
          onClick={() => step(1)}
          className={`${STEP_BUTTON} ${large ? "px-2.5" : "px-1"}`}
        >
          <Chevron up large={large} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${label}, £1 less`}
          onClick={() => step(-1)}
          disabled={pence <= 0}
          className={`${STEP_BUTTON} ${large ? "px-2.5" : "px-1"}`}
        >
          <Chevron up={false} large={large} />
        </button>
      </span>
    </span>
  );
}
