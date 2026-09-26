"use client";

import type { JudgeMode, TraceEvent } from "@/lib/decision";

type Props = {
  trace: TraceEvent[];
  mode: JudgeMode | null;
  /** Short model name, e.g. "claude-sonnet-4-6", or "mock". */
  model: string | null;
  open: boolean;
  onToggle: () => void;
};

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function TracePanel({ trace, mode, model, open, onToggle }: Props) {
  return (
    <aside
      className={`flex h-full min-h-0 flex-col border-l border-line bg-panel transition-[width] duration-150 ${
        open ? "w-[22rem]" : "w-10"
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Collapse trace" : "Expand trace"}
          className="rounded px-1.5 py-0.5 text-xs text-muted hover:text-foreground"
        >
          {open ? "›" : "‹"}
        </button>
        {open && (
          <div className="flex items-center gap-2 text-xs">
            <span className="uppercase tracking-wide text-muted">Trace</span>
            {mode && <ModePill mode={mode} model={model} />}
          </div>
        )}
      </div>
      {open ? (
        <ol className="flex-1 space-y-2 overflow-y-auto px-3 py-3 font-mono text-xs">
          {trace.length === 0 && <li className="text-muted">No tool calls yet.</li>}
          {trace.map((e, i) => (
            <li key={`${e.t}-${i}`} className="grid grid-cols-[3.9rem_1fr] gap-2">
              <span className="tnum text-muted">{clock(e.t)}</span>
              <span>
                <span className="text-accent">{e.tool}</span>
                <span className="text-muted"> → </span>
                <span className="tnum break-words text-foreground">{e.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-2 pt-3">
          {mode && <ModePill mode={mode} model={model} vertical />}
        </div>
      )}
    </aside>
  );
}

function ModePill({ mode, model, vertical = false }: { mode: JudgeMode; model: string | null; vertical?: boolean }) {
  const live = mode === "bedrock";
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        live ? "border-accent text-accent" : "border-line text-muted"
      } ${vertical ? "[writing-mode:vertical-rl]" : ""}`}
      title={live ? `Decisions from Amazon Bedrock (${model ?? "model"})` : "Deterministic mock: COVERED_MOCK=1 or Bedrock access failed"}
    >
      {live ? (model ?? "bedrock") : "mock"}
    </span>
  );
}
