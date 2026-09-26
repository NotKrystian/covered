"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { Decision, UserSettings } from "@/lib/types";
import { isProtected, type DecideResponse, type ShortlistItem } from "@/lib/decision";
import { formatPence } from "@/lib/money";
import { DEFAULT_SORT, sortListings, type SortKey } from "@/lib/sort-listings";
import {
  approveChosen,
  decide,
  liveGridErrorKind,
  liveGridErrorLine,
  patchMemory,
  readLiveGrid,
  type MemoryState,
} from "@/lib/client/shop";
import { ListingThumb, ListingTitle } from "@/components/ListingMedia";
import { PaySheet } from "@/components/PaySheet";
import { PoundField } from "@/components/PoundField";
import { SortControl } from "@/components/SortControl";
import { WalletStrip } from "@/components/WalletStrip";

type Props = {
  memoryState: MemoryState;
  onMemory: (next: MemoryState) => void;
};

type SearchError = { kind: "no_extension" | "challenge" | "other"; message: string };

function sellerLine(d: Decision): string {
  const seller: Record<Decision["seller_type"], string> = {
    uk_business: "UK business",
    private: "private seller",
    overseas_business: "overseas business",
    unclear: "seller unclear",
  };
  const venue: Record<Decision["venue_trust"], string> = {
    shop_checkout: "shop checkout",
    marketplace_protected: "marketplace, protected",
    marketplace_unprotected: "marketplace, unprotected",
    stranger: "stranger",
    unclear: "venue unclear",
  };
  return `${seller[d.seller_type]} · ${venue[d.venue_trust]}`;
}

function OfferRow({
  item,
  decision,
  chosen,
  approving,
  onApprove,
}: {
  item: ShortlistItem;
  decision?: Decision;
  chosen: boolean;
  approving: boolean;
  onApprove: () => void;
}) {
  const rejected = Boolean(decision && (decision.mislisting || !decision.same_item));
  const reason = decision ? (decision.mislisting && decision.photo_reason ? decision.photo_reason : decision.reason) : null;
  return (
    <li
      className={`rounded-xl border px-4 py-4 ${
        chosen ? "chosen-glow border-accent bg-accent-soft" : rejected ? "border-line opacity-70" : "border-line bg-panel"
      }`}
    >
      <div className="flex gap-4">
        <ListingThumb item={item} dim={rejected} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <ListingTitle
                  item={item}
                  className={`font-medium ${rejected ? "line-through decoration-danger/70" : ""}`}
                />
                {item.section === "sponsored" && (
                  <span className="rounded border border-line px-1.5 text-[10px] uppercase tracking-wide text-muted">Ad</span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">
                {item.merchant}
                {item.delivery ? ` · ${item.delivery}` : ""}
                {item.returns ? ` · ${item.returns}` : ""}
              </p>
              {decision && <p className="mt-0.5 text-xs text-muted">{sellerLine(decision)}</p>}
            </div>
            <div className="tnum shrink-0 text-right text-lg font-semibold">{item.price_label}</div>
          </div>
          {reason && (
            <p className={`mt-3 text-sm ${rejected ? "text-danger" : chosen ? "text-accent" : "text-muted"}`}>
              {rejected && decision?.mislisting ? "Mislisting: " : ""}
              {reason}
            </p>
          )}
          {chosen && (
            <button
              type="button"
              onClick={onApprove}
              disabled={approving}
              className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-50"
            >
              {approving ? "Approving…" : "Approve"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function Dashboard({ memoryState, onMemory }: Props) {
  const memory = memoryState.memory;
  const greeting = memory.display_name?.trim() ? `Hello, ${memory.display_name.trim()}` : "Hello";
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<UserSettings>(memory.settings);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState<DecideResponse | null>(null);
  const [error, setError] = useState<SearchError | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [balancePence, setBalancePence] = useState(memory.balance_pence);
  const [payOpen, setPayOpen] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);

  const savePrefs = useCallback(async () => {
    const next = await patchMemory({ settings });
    if (next) onMemory(next);
    setPrefsOpen(false);
  }, [settings, onMemory]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q || running) return;
    setRunning(true);
    setError(null);
    setReceipt(null);
    setWalletError(null);
    setPayOpen(false);
    setPayError(null);
    setResult(null);
    try {
      const attempt = await readLiveGrid(q);
      if (!attempt.ok) {
        setError({ kind: liveGridErrorKind(attempt.reason), message: liveGridErrorLine(attempt.reason) });
        return;
      }
      const data = await decide(q, settings, memory.display_name ?? "", attempt.result);
      setResult(data);
    } catch (err) {
      setError({
        kind: "other",
        message: err instanceof Error ? err.message : "Something broke.",
      });
    } finally {
      setRunning(false);
    }
  }, [query, running, settings, memory.display_name]);

  const approve = useCallback(async () => {
    if (!result) return;
    setApproving(true);
    setWalletError(null);
    setPayError(null);
    try {
      const done = await approveChosen(query, result, settings);
      if (!done.ok) {
        if (done.status === 402) {
          setWalletError(done.error);
          setPayError(done.error);
        } else {
          setError({ kind: "other", message: done.error });
          setPayError(done.error);
        }
        return;
      }
      setBalancePence(done.balance_pence);
      const chosen = result.listings.find((i) => i.id === result.verdict.chosen_id);
      setPayOpen(false);
      setReceipt(
        `Paid ${chosen?.price_label ?? ""} to ${chosen?.merchant ?? "listing"} · wallet ${formatPence(done.balance_pence)}`,
      );
    } finally {
      setApproving(false);
    }
  }, [result, query, settings]);

  const rows = useMemo(
    () => sortListings(result?.listings ?? [], sort, result?.decisions ?? {}, result?.brief_brand ?? ""),
    [result, sort],
  );
  const chosenId = result?.verdict.chosen_id ?? null;
  const chosenItem = chosenId ? rows.find((i) => i.id === chosenId) ?? null : null;

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b border-line px-6 py-5">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold tracking-tight">Covered</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{greeting}</h1>
            <p className="mt-1 text-sm text-muted">
              Wallet {formatPence(balancePence)}
              <span className="mx-2 text-line">·</span>
              <Link href="/orders" className="hover:text-foreground">
                Orders
              </Link>
              <span className="mx-2 text-line">·</span>
              <Link href="/ext" className="hover:text-foreground">
                reader
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <WalletStrip compact balancePence={balancePence} onBalance={setBalancePence} />
            <button
              type="button"
              onClick={() => setPrefsOpen((o) => !o)}
              className="text-sm text-muted hover:text-foreground"
            >
              Preferences
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {prefsOpen && (
          <section className="mb-10 rounded-xl border border-line bg-panel px-5 py-5">
            <h2 className="text-sm font-semibold">Preferences</h2>
            <p className="mt-1 text-sm text-muted">The two pound rules. Reset memory lives on the quiet dev screen.</p>
            <div className="mt-4 flex flex-wrap items-center gap-6 text-sm">
              <label className="flex items-center gap-2 text-muted">
                Pay up to
                <PoundField
                  label="Protection premium in pounds"
                  pence={settings.protection_premium_pence}
                  onPence={(p) => setSettings({ ...settings, protection_premium_pence: p })}
                />
                more for rights
              </label>
              <label className="flex items-center gap-2 text-muted">
                Switch if I clear
                <PoundField
                  label="Switch minimum in pounds"
                  pence={settings.switch_minimum_pence}
                  onPence={(p) => setSettings({ ...settings, switch_minimum_pence: p })}
                />
              </label>
              <button
                type="button"
                onClick={() => void savePrefs()}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-background"
              >
                Save
              </button>
            </div>
          </section>
        )}

        <form
          className="flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What do you want to buy?"
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-4 py-3 text-base outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={running || query.trim().length === 0}
            className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-50"
          >
            {running ? "Searching…" : "Search"}
          </button>
        </form>

        <div className="mt-10">
          {running && (
            <div className="rounded-xl border border-line bg-panel px-6 py-16 text-center">
              <p className="text-sm text-muted">Reading the shelf and judging every listing…</p>
            </div>
          )}

          {!running && error && (
            <div className="rounded-xl border border-line bg-panel px-6 py-12">
              <h2 className="text-lg font-semibold">
                {error.kind === "no_extension"
                  ? "The reader is not installed"
                  : error.kind === "challenge"
                    ? "Google challenged this search"
                    : "Search did not finish"}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">{error.message}</p>
              {error.kind === "no_extension" && (
                <p className="mt-4 text-sm">
                  <Link href="/ext" className="text-accent hover:underline">
                    Install the Covered reader
                  </Link>{" "}
                  in Brave, then reload the extension and try again.
                </p>
              )}
              {error.kind === "challenge" && (
                <p className="mt-4 text-sm text-muted">
                  Sign in to Google in Brave, pass the check in a normal tab, then search again. Covered will not bypass it.
                </p>
              )}
            </div>
          )}

          {!running && !error && !result && (
            <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
              <p className="text-sm text-muted">
                Search for something. Covered buys the cheapest listing that is actually the item and still has your rights.
              </p>
            </div>
          )}

          {!running && result && (
            <div className="space-y-6">
              <p
                className={`text-base leading-relaxed ${
                  chosenId && result.decisions[chosenId] && isProtected(result.decisions[chosenId])
                    ? "text-accent"
                    : "text-foreground"
                }`}
              >
                {result.verdict.summary}
              </p>
              {walletError && (
                <div className="rounded-xl border border-danger/40 bg-danger-soft px-5 py-4 text-sm">
                  <p className="font-medium">Wallet is short</p>
                  <p className="mt-1 text-muted">{walletError} Deposit above, then Approve again.</p>
                </div>
              )}
              {receipt && (
                <p className="rounded-xl border border-accent/40 bg-accent-soft px-5 py-3 text-sm">{receipt}</p>
              )}
              {rows.length === 0 ? (
                <p className="text-sm text-muted">No listings came back for that search.</p>
              ) : (
                <>
                  <div className="flex justify-end">
                    <SortControl value={sort} onChange={setSort} />
                  </div>
                  <ul className="space-y-3">
                    {rows.map((item) => (
                      <OfferRow
                        key={item.id}
                        item={item}
                        decision={result.decisions[item.id]}
                        chosen={item.id === chosenId}
                        approving={approving}
                        onApprove={() => {
                          setPayError(null);
                          setPayOpen(true);
                        }}
                      />
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <p className="mt-16 text-center text-[11px] text-muted">
          <Link href="/dev" className="hover:text-foreground">
            dev
          </Link>
        </p>
      </main>
      {payOpen && chosenItem && (
        <PaySheet
          merchant={chosenItem.merchant}
          title={chosenItem.title}
          pricePence={chosenItem.price_pence}
          priceLabel={chosenItem.price_label}
          balancePence={balancePence}
          rights={result?.decisions[chosenItem.id]?.rights ?? []}
          paying={approving}
          error={payError}
          onPay={() => void approve()}
          onClose={() => setPayOpen(false)}
        />
      )}
    </div>
  );
}
