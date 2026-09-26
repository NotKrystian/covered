"use client";

import { useState } from "react";

export function CopyText({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-2">
      <code className="max-w-full overflow-x-auto rounded border border-line bg-panel-raised px-2 py-1 font-mono text-sm text-foreground">
        {value}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="shrink-0 text-xs text-muted hover:text-foreground"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
