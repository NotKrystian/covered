"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMemory, patchMemory, type MemoryState } from "@/lib/client/shop";
import { loadOnboarding } from "@/lib/client/onboarding-progress";
import { Dashboard } from "@/components/Dashboard";
import { Onboarding } from "@/components/Onboarding";

export default function Home() {
  const [memoryState, setMemoryState] = useState<MemoryState | null>(null);
  const [ready, setReady] = useState(false);

  const apply = useCallback((next: MemoryState) => {
    setMemoryState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next = await fetchMemory();
      // The server forgot (e.g. the dev server restarted with in-process memory) but this
      // browser finished onboarding: restore the saved answers instead of asking again.
      const saved = loadOnboarding();
      if (next && !next.memory.onboarded && saved?.done) {
        next =
          (await patchMemory({
            display_name: saved.name.trim() || undefined,
            settings: saved.settings,
            onboarded: true,
          })) ?? next;
      }
      if (cancelled) return;
      if (next) apply(next);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  if (!ready) {
    return (
      <div className="flex min-h-full items-center justify-center bg-background text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (!memoryState || !memoryState.memory.onboarded) {
    return (
      <Onboarding
        onDone={(next, balance) => {
          apply({
            ...next,
            memory: { ...next.memory, balance_pence: balance, onboarded: true },
          });
        }}
      />
    );
  }

  return <Dashboard memoryState={memoryState} onMemory={apply} />;
}
