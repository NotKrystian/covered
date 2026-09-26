"use client";

import { isSortKey, SORT_OPTIONS, type SortKey } from "@/lib/sort-listings";

type Props = {
  value: SortKey;
  onChange: (next: SortKey) => void;
};

export function SortControl({ value, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 normal-case tracking-normal text-muted">
      <span className="text-[11px] uppercase tracking-wide">Sort</span>
      <select
        value={value}
        aria-label="Sort"
        onChange={(e) => {
          if (isSortKey(e.target.value)) onChange(e.target.value);
        }}
        className="rounded border border-line bg-panel-raised px-2 py-1 text-foreground outline-none focus:border-accent"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
