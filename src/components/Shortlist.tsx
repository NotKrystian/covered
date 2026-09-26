"use client";

import Image from "next/image";
import type { Decision } from "@/lib/types";
import type { ShortlistItem } from "@/lib/decision";

type Props = {
  items: ShortlistItem[];
  decisions: Record<string, Decision>;
  chosenId: string | null;
  loading: boolean;
};

type RowState = "chosen" | "rejected" | "neutral";

function rowState(item: ShortlistItem, decision: Decision | undefined, chosenId: string | null): RowState {
  if (item.id === chosenId) return "chosen";
  if (decision && (decision.mislisting || !decision.same_item)) return "rejected";
  return "neutral";
}

function Thumb({ item, dim }: { item: ShortlistItem; dim: boolean }) {
  const src = item.image_urls[0];
  return (
    <div
      className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-line bg-panel-raised ${dim ? "opacity-40" : ""}`}
    >
      {src ? (
        <Image src={src} alt="" width={80} height={80} unoptimized className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wide text-muted">
          no photo
        </div>
      )}
    </div>
  );
}

function sellerLabel(d: Decision): string {
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

export function Shortlist({ items, decisions, chosenId, loading }: Props) {
  if (items.length === 0) {
    return (
      <section className="flex h-full items-center justify-center text-sm text-muted">
        {loading ? "Reading the shelf…" : "No shortlist yet. Send a query or load the fixtures."}
      </section>
    );
  }

  return (
    <section className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 grid grid-cols-[5rem_minmax(0,1fr)_5.5rem_9rem_9rem_9rem_3.5rem] gap-3 border-b border-line bg-background/95 px-5 py-2 text-[11px] uppercase tracking-wide text-muted backdrop-blur">
        <span>Photo</span>
        <span>Listing</span>
        <span className="text-right">Price</span>
        <span>Merchant</span>
        <span>Delivery</span>
        <span>Returns</span>
        <span className="text-right">Rating</span>
      </div>
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const d = decisions[item.id];
          const state = rowState(item, d, chosenId);
          const rowClass =
            state === "chosen"
              ? "chosen-glow bg-accent-soft ring-1 ring-accent"
              : state === "rejected"
                ? "opacity-80"
                : "";
          const strike = state === "rejected" ? "line-through decoration-danger/70" : "";
          const reason = d ? (d.mislisting && d.photo_reason ? d.photo_reason : d.reason) : null;
          return (
            <li key={item.id} className={`px-5 py-3 ${rowClass}`}>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)_5.5rem_9rem_9rem_9rem_3.5rem] items-start gap-3 text-sm">
                <Thumb item={item} dim={state === "rejected"} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`truncate font-medium ${strike}`}>{item.title}</span>
                    {item.section === "sponsored" && (
                      <span className="rounded border border-line px-1 text-[10px] uppercase tracking-wide text-muted">
                        Ad
                      </span>
                    )}
                    {item.badge && (
                      <span className="rounded border border-line px-1 text-[10px] text-muted">{item.badge}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    <span className="font-mono">{item.id}</span>
                    {d && <span> · {sellerLabel(d)}</span>}
                  </div>
                  {d && d.rights.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {d.rights.map((r) => (
                        <span key={r} className="rounded bg-panel-raised px-1.5 py-0.5 text-[11px] text-muted">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={`tnum text-right font-semibold ${strike}`}>{item.price_label}</div>
                <div className="truncate text-muted">{item.merchant}</div>
                <div className="truncate text-muted">{item.delivery ?? "—"}</div>
                <div className="truncate text-muted">{item.returns ?? "—"}</div>
                <div className="tnum text-right text-muted">
                  {item.rating ?? "—"}
                  {item.rating_count && <span className="block text-[10px]">({item.rating_count})</span>}
                </div>
              </div>
              {reason && (
                <p
                  className={`mt-2 pl-[5.75rem] text-sm ${
                    state === "rejected"
                      ? "text-danger"
                      : state === "chosen"
                        ? "text-accent"
                        : "text-muted"
                  }`}
                >
                  {state === "rejected" && d?.mislisting ? "Mislisting: " : ""}
                  {reason}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
