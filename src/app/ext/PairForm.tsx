"use client";

import { useState } from "react";

type ClaimResponse =
  | { ok: true; user_id: string; paired_devices: number }
  | { ok: false; error: string };

/** Enter the popup's 6-character code here to make THIS browser the same Covered user. */
export function PairForm() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/pair/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: trimmed, label: "web" }),
      });
      const json = (await res.json().catch(() => null)) as ClaimResponse | null;
      if (!json || !json.ok) {
        setError(json && !json.ok ? json.error : `Pairing failed (${res.status})`);
        return;
      }
      setDone(`Paired. This browser now shares the reader with ${json.paired_devices} device${json.paired_devices === 1 ? "" : "s"}. Searches here run on the paired Brave.`);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-4 flex flex-wrap items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABC234"
        maxLength={8}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Pair code"
        className="w-32 rounded-md border border-line bg-panel px-3 py-2 font-mono text-base tracking-widest outline-none placeholder:text-muted focus:border-accent"
      />
      <button
        type="submit"
        disabled={busy || code.trim().length < 6}
        className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-50"
      >
        {busy ? "Pairing…" : "Pair this browser"}
      </button>
      {done && <p className="basis-full text-sm text-accent">{done}</p>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  );
}
