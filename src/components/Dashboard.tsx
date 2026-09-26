"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Decision, UserSettings } from "@/lib/types";
import {
  isMonthlyOnlyItem,
  isProtected,
  monthlyMetaLabel,
  reapplyPremium,
  type DecideResponse,
  type ShortlistItem,
} from "@/lib/decision";
import { partitionCashAndMonthly } from "@/lib/listing-display";
import { formatBps, formatPence } from "@/lib/money";
import type { Limit } from "@/lib/memory";
import { DEFAULT_SORT, sortListings, type SortKey } from "@/lib/sort-listings";
import {
  approveListing,
  recordOverride,
  createLimit,
  decide,
  fetchLimits,
  liveGridErrorKind,
  liveGridErrorLine,
  patchMemory,
  readLiveGrid,
  removeLimit,
  type LiveGridPhase,
  type MemoryState,
} from "@/lib/client/shop";
import { ListingThumb, ListingTitle } from "@/components/ListingMedia";
import { ActiveLimits, LimitEditor } from "@/components/LimitControls";
import { SwitchWatchList } from "@/components/SwitchWatchList";
import { fetchSwitchWatches, type SwitchWatch } from "@/lib/client/switch";
import { coolingOffBlock } from "@/lib/switch-rule";
import { PaySheet } from "@/components/PaySheet";
import { PercentField } from "@/components/PercentField";
import { PoundField } from "@/components/PoundField";
import { SortControl } from "@/components/SortControl";
import { AppHeader } from "@/components/AppHeader";
import { protectedAlternative } from "@/lib/protected-pick";
import { LoadingDots } from "@/components/LoadingDots";

type Props = {
  memoryState: MemoryState;
  onMemory: (next: MemoryState) => void;
};

type SearchError = { kind: "no_extension" | "challenge" | "other"; message: string };
type SearchPhase = LiveGridPhase | "judging";

/** The working line while a search runs; the page adds animated dots. */
function phaseLine(phase: SearchPhase): string {
  switch (phase) {
    case "extension":
      return "Reading Google Shopping in this browser";
    case "remote_reader":
      return "Reading Google Shopping on your paired browser";
    case "server":
      return "Reading the shelf";
    case "judging":
      return "Judging every listing";
    default: {
      const never: never = phase;
      return String(never);
    }
  }
}

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
  onLimit,
}: {
  item: ShortlistItem;
  decision?: Decision;
  chosen: boolean;
  approving: boolean;
  onApprove: () => void;
  onLimit: () => void;
}) {
  const rejected = Boolean(decision && (decision.mislisting || !decision.same_item));
  const reason = decision ? (decision.mislisting && decision.photo_reason ? decision.photo_reason : decision.reason) : null;
  const priceNote = monthlyMetaLabel(item);
  const monthlyOnly = isMonthlyOnlyItem(item);
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
                {chosen && (
                  <span className="rounded border border-accent px-1.5 text-[10px] uppercase tracking-wide text-accent">
                    Recommended
                  </span>
                )}
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
            <div className="tnum shrink-0 text-right">
              <div className="text-lg font-semibold">{item.price_label}</div>
              {priceNote && <div className="mt-0.5 text-xs font-normal text-muted">{priceNote}</div>}
            </div>
          </div>
          {reason && (
            <p className={`mt-3 text-sm ${rejected ? "text-danger" : chosen ? "text-accent" : "text-muted"}`}>
              {rejected && decision?.mislisting ? "Mislisting: " : ""}
              {reason}
            </p>
          )}
          {chosen && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onApprove}
                disabled={approving}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:brightness-110 disabled:opacity-50"
              >
                {approving ? "Buying…" : "Buy now"}
              </button>
              {monthlyOnly ? (
                <span className="text-sm text-muted">Limits are for cash prices</span>
              ) : (
                <button
                  type="button"
                  onClick={onLimit}
                  className="rounded-md border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent-soft"
                >
                  Set a limit
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function ResultGroups({
  groups,
  decisions,
  chosenId,
  approving,
  onApprove,
  onLimit,
}: {
  groups: { cash: ShortlistItem[]; monthly: ShortlistItem[] };
  decisions: Record<string, Decision>;
  chosenId: string | null;
  approving: boolean;
  onApprove: () => void;
  onLimit: (item: ShortlistItem) => void;
}) {
  const list = (items: ShortlistItem[]) => (
    <ul className="space-y-3">
      {items.map((item) => (
        <OfferRow
          key={item.id}
          item={item}
          decision={decisions[item.id]}
          chosen={item.id === chosenId}
          approving={approving}
          onApprove={onApprove}
          onLimit={() => onLimit(item)}
        />
      ))}
    </ul>
  );
  if (groups.monthly.length === 0) return list(groups.cash);
  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Pay outright</h2>
        {groups.cash.length > 0 ? list(groups.cash) : <p className="text-sm text-muted">No cash prices in this search.</p>}
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Pay monthly</h2>
        {list(groups.monthly)}
      </div>
    </div>
  );
}

export function Dashboard({ memoryState, onMemory }: Props) {
  const memory = memoryState.memory;
  const greeting = memory.display_name?.trim() ? `Hello, ${memory.display_name.trim()}` : "Hello";
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<UserSettings>(memory.settings);
  // The cog on other pages links to /?preferences. The dashboard only mounts in the browser.
  const [prefsOpen, setPrefsOpen] = useState(() => new URLSearchParams(window.location.search).has("preferences"));
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<SearchPhase>("extension");
  const [approving, setApproving] = useState(false);
  const [result, setResult] = useState<DecideResponse | null>(null);
  const [error, setError] = useState<SearchError | null>(null);
  /** The last purchase, shown after the search clears; `switchBlock` says why it has no 14-day watch. */
  const [receipt, setReceipt] = useState<{ line: string; switchBlock: string | null } | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [balancePence, setBalancePence] = useState(memory.balance_pence);
  const [payOpen, setPayOpen] = useState(false);
  /** The listing the pay sheet is for: null is the verdict's pick; otherwise the UK-seller option. */
  const [payId, setPayId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [limits, setLimits] = useState<Limit[]>(memory.limits ?? []);
  const [limitDraft, setLimitDraft] = useState<{ query: string; defaultPence: number | null } | null>(null);
  const [watches, setWatches] = useState<SwitchWatch[]>([]);

  // Opened from /?preferences: drop the query so a reload does not reopen it.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", "/");
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLimits().then((next) => {
      if (!cancelled) setLimits(next);
    });
    fetchSwitchWatches().then((next) => {
      if (!cancelled) setWatches(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshWatches = useCallback(async () => {
    setWatches(await fetchSwitchWatches());
  }, []);

  const saveLimit = useCallback(async (pence: number, forQuery: string) => {
    const q = forQuery.trim();
    if (!q) throw new Error("Type a product first.");
    const done = await createLimit(q, pence);
    if (!done.ok) throw new Error(done.error);
    setLimits(done.limits);
    setLimitDraft(null);
  }, []);

  /** A listing's Limit opens the editor at the top of the page: scroll up to it so the buyer sees what to confirm. */
  const openLimit = useCallback((draft: { query: string; defaultPence: number | null }) => {
    setLimitDraft(draft);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: still ? "auto" : "smooth" });
  }, []);

  const cancelLimit = useCallback(async (id: string) => {
    const done = await removeLimit(id);
    if (done.ok) setLimits(done.limits);
  }, []);

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
    setPhase("extension");
    try {
      const attempt = await readLiveGrid(q, setPhase);
      if (!attempt.ok) {
        setError({ kind: liveGridErrorKind(attempt.reason), message: liveGridErrorLine(attempt.reason) });
        return;
      }
      setPhase("judging");
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
      const live = reapplyPremium(result, settings);
      const targetId = payId ?? live.verdict.chosen_id;
      if (!targetId) return;
      const done = await approveListing(query, live, targetId, settings);
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
      const chosen = live.listings.find((i) => i.id === targetId);
      const suggested = live.listings.find((i) => i.id === live.verdict.chosen_id);
      if (chosen && suggested && chosen.id !== suggested.id) {
        // Paying more for a UK seller is an override: memory should lean that way next time.
        void recordOverride(
          query,
          chosen.id,
          settings.protection_premium_pence,
          `chose ${chosen.merchant} at ${chosen.price_label} over ${suggested.merchant} at ${suggested.price_label} to keep the right to return`.slice(0, 200),
        );
      }
      setPayOpen(false);
      setReceipt({
        line: `Paid ${chosen?.price_label ?? ""} to ${chosen?.merchant ?? "listing"} from your Covered demo wallet · balance ${formatPence(done.balance_pence)}`,
        switchBlock: coolingOffBlock(chosen ? live.decisions[chosen.id]?.seller_type : undefined),
      });
      // Bought: clear the search so the next one starts fresh and nothing can be approved twice.
      setResult(null);
      setQuery("");
      void refreshWatches();
    } finally {
      setApproving(false);
    }
  }, [result, payId, query, settings, refreshWatches]);

  const live = useMemo(() => (result ? reapplyPremium(result, settings) : null), [result, settings]);
  const rows = useMemo(
    () =>
      sortListings(
        live?.listings ?? [],
        sort,
        live?.decisions ?? {},
        live?.brief_brand ?? "",
        live?.verdict.chosen_id ?? null,
      ),
    [live, sort],
  );
  const chosenId = live?.verdict.chosen_id ?? null;
  const chosenItem = chosenId ? rows.find((i) => i.id === chosenId) ?? null : null;
  const ukOption = live ? protectedAlternative(live) : null;
  const payItem = payId ? rows.find((i) => i.id === payId) ?? null : chosenItem;
  const openPay = (id: string | null) => {
    setPayError(null);
    setPayId(id);
    setPayOpen(true);
  };
  const listingGroups = partitionCashAndMonthly(rows);

  return (
    <div className="min-h-full bg-background text-foreground">
      <AppHeader
        balancePence={balancePence}
        onSettings={() => setPrefsOpen((o) => !o)}
        settingsOpen={prefsOpen}
      />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{greeting}</h1>
        {prefsOpen && (
          <section className="mb-10 rounded-xl border border-line bg-panel px-5 py-5">
            <h2 className="text-sm font-semibold">Preferences</h2>
            <p className="mt-1 text-sm text-muted">
              Pay up to {formatBps(settings.protection_premium_bps)} more to keep UK buyer rights. That&apos;s how far
              below a UK shop the cheaper listing can be before you take it. Reset memory lives on the quiet dev screen.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-6 text-sm">
              <label className="flex items-center gap-2 text-muted">
                Pay up to
                <PercentField
                  label="Protection premium as a percent of the UK shop"
                  bps={settings.protection_premium_bps}
                  onBps={(bps) => setSettings({ ...settings, protection_premium_bps: bps })}
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
            {running ? (
              <>
                Searching
                <LoadingDots />
              </>
            ) : (
              "Search"
            )}
          </button>
        </form>
        {limitDraft && (
          // Keyed per listing: a second Limit restarts the editor with that price and glows again.
          <div key={`${limitDraft.query}|${limitDraft.defaultPence}`} className="chosen-glow mt-3 rounded-xl">
            <LimitEditor
              query={limitDraft.query}
              defaultPence={limitDraft.defaultPence}
              onConfirm={(pence) => saveLimit(pence, limitDraft.query)}
              onCancel={() => setLimitDraft(null)}
            />
          </div>
        )}
        <ActiveLimits limits={limits} onRemove={(id) => void cancelLimit(id)} />
        <SwitchWatchList watches={watches} onWatches={setWatches} onRefresh={refreshWatches} />

        <div className="mt-10">
          {running && (
            <div className="rounded-xl border border-line bg-panel px-6 py-16 text-center">
              <p className="text-sm text-muted">
                {phaseLine(phase)}
                <LoadingDots />
              </p>
              {phase === "remote_reader" && (
                <p className="mt-2 text-xs text-muted">
                  The Covered reader is not in this browser, so the job went to the Brave you paired. Up to 45 seconds.
                </p>
              )}
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
                  in Brave, Chrome or Firefox, then reload this page and try again. Or pair this device to a browser that
                  already has it: open the extension popup there and enter its code on{" "}
                  <Link href="/ext#pair" className="text-accent hover:underline">
                    /ext
                  </Link>
                  .
                </p>
              )}
              {error.kind === "challenge" && (
                <p className="mt-4 text-sm text-muted">
                  Sign in to Google in your browser, pass the check in a normal tab, then search again. Covered will not bypass it.
                </p>
              )}
            </div>
          )}

          {!running && receipt && (
            <div className="space-y-3">
              <p className="rounded-xl border border-accent/40 bg-accent-soft px-5 py-3 text-sm">{receipt.line}</p>
              {receipt.switchBlock ? (
                <p className="rounded-xl border border-line px-5 py-4 text-sm text-muted">
                  No 14-day price-drop watch on this order: {receipt.switchBlock}.
                </p>
              ) : (
                <div className="rounded-xl border border-line px-5 py-4">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    14-day price-drop watch
                    <span className="rounded-full border border-accent/40 px-2 py-px text-[10px] font-normal uppercase tracking-wide text-accent">
                      On
                    </span>
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    For your 14-day cooling-off window, Covered re-checks this price and tells you when a UK shop has it
                    for at least {formatPence(settings.switch_minimum_pence)} less after return postage. See the watch above.
                  </p>
                </div>
              )}
            </div>
          )}

          {!running && !error && !result && !receipt && (
            <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
              <p className="text-sm text-muted">
                Buy it now, or set a limit and your laptop checks every hour.
              </p>
            </div>
          )}

          {!running && live && (
            <div className="space-y-6">
              <section
                aria-labelledby="agent-decision"
                className={`rounded-xl border px-5 py-4 ${
                  chosenId && live.decisions[chosenId] && isProtected(live.decisions[chosenId])
                    ? "border-accent/40 bg-accent-soft"
                    : "border-line bg-panel"
                }`}
              >
                <h2 id="agent-decision" className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  Agent decision
                </h2>
                <p className="mt-1.5 text-base leading-relaxed">{live.verdict.summary}</p>
              </section>
              {ukOption && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-5 py-4">
                  <p className="min-w-0 flex-1 basis-72 text-sm">
                    <span className="font-medium">Rather be able to send it back?</span>{" "}
                    <span className="text-muted">
                      {ukOption.item.merchant} has it for {ukOption.item.price_label}
                      {ukOption.extra_pence > 0 ? `, ${formatPence(ukOption.extra_pence)} more,` : ""} with the 14-day
                      right to cancel and a 30-day fault refund.
                    </span>
                  </p>
                  <button
                    type="button"
                    disabled={approving}
                    onClick={() => openPay(ukOption.item.id)}
                    className="shrink-0 rounded-md border border-accent/60 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent-soft disabled:opacity-50"
                  >
                    Buy from {ukOption.item.merchant}
                  </button>
                </div>
              )}
              {walletError && (
                <div className="rounded-xl border border-danger/40 bg-danger-soft px-5 py-4 text-sm">
                  <p className="font-medium">Wallet is short</p>
                  <p className="mt-1 text-muted">{walletError} Approve again and use Add money on the pay sheet.</p>
                </div>
              )}
              {rows.length === 0 ? (
                <p className="text-sm text-muted">No listings came back for that search.</p>
              ) : (
                <>
                  <div className="flex justify-end">
                    <SortControl value={sort} onChange={setSort} />
                  </div>
                  <ResultGroups
                    groups={listingGroups}
                    decisions={live.decisions}
                    chosenId={chosenId}
                    approving={approving}
                    onApprove={() => openPay(null)}
                    onLimit={(item) =>
                      openLimit({
                        query: query.trim(),
                        defaultPence: item.price_pence,
                      })
                    }
                  />
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
      {payOpen && payItem && (
        <PaySheet
          // Remount per listing: switching to the UK option starts that sheet fresh.
          key={payItem.id}
          merchant={payItem.merchant}
          title={payItem.title}
          pricePence={payItem.price_pence}
          priceLabel={payItem.price_label}
          balancePence={balancePence}
          rights={live?.decisions[payItem.id]?.rights ?? []}
          decision={live?.decisions[payItem.id] ?? null}
          alternative={
            payItem.id === chosenId && ukOption
              ? {
                  merchant: ukOption.item.merchant,
                  priceLabel: ukOption.item.price_label,
                  extraPence: ukOption.extra_pence,
                  onChoose: () => setPayId(ukOption.item.id),
                }
              : undefined
          }
          onBalance={setBalancePence}
          paying={approving}
          error={payError}
          onPay={() => void approve()}
          onClose={() => setPayOpen(false)}
        />
      )}
    </div>
  );
}
