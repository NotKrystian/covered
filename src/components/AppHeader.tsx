"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatPence } from "@/lib/money";

type Props = {
  /** The page's live balance. Pages without one (the reader page) leave it out and the header fetches it. */
  balancePence?: number;
  /** On the dashboard the cog toggles preferences in place; elsewhere it links there. */
  onSettings?: () => void;
  settingsOpen?: boolean;
};

const LINKS = [
  { href: "/", label: "Shop" },
  { href: "/orders", label: "Orders" },
  { href: "/ext", label: "Reader" },
  { href: "/wallet", label: "Wallet" },
] as const;

function CogIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * The one header for the buyer pages: brand, the page links grouped together (the
 * wallet link carries the only balance on the page), and a settings cog top right.
 */
export function AppHeader({ balancePence, onSettings, settingsOpen = false }: Props) {
  const pathname = usePathname();
  const [fetchedPence, setFetchedPence] = useState<number | null>(null);
  const shownPence = balancePence ?? fetchedPence;

  useEffect(() => {
    if (balancePence !== undefined) return;
    let cancelled = false;
    fetch("/api/wallet")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { balance_pence?: number } | null) => {
        if (!cancelled && typeof json?.balance_pence === "number") setFetchedPence(json.balance_pence);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [balancePence]);
  const cogClass =
    "flex h-9 w-9 items-center justify-center rounded-lg border text-muted hover:text-foreground " +
    (settingsOpen ? "border-accent text-foreground" : "border-line hover:border-accent");

  return (
    <header className="border-b border-line py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="mr-auto text-base font-semibold tracking-tight">
          Covered
        </Link>
        <nav
          aria-label="Covered"
          className="order-last flex w-full rounded-lg border border-line bg-panel p-1 text-sm sm:order-none sm:w-auto"
        >
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 sm:flex-none ${
                  active ? "bg-panel-raised font-medium text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {link.label}
                {link.href === "/wallet" && shownPence !== null && (
                  <span className="tnum font-semibold text-foreground">{formatPence(shownPence)}</span>
                )}
              </Link>
            );
          })}
        </nav>
        {onSettings ? (
          <button
            type="button"
            onClick={onSettings}
            aria-label="Preferences"
            aria-expanded={settingsOpen}
            title="Preferences"
            className={cogClass}
          >
            <CogIcon />
          </button>
        ) : (
          <Link href="/?preferences" aria-label="Preferences" title="Preferences" className={cogClass}>
            <CogIcon />
          </Link>
        )}
      </div>
    </header>
  );
}
