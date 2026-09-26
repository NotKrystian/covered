import type { Metadata } from "next";
import Link from "next/link";
import { BrowserIcon } from "./BrowserIcon";
import { CopyText } from "./CopyText";
import { PairForm } from "./PairForm";
import { COVERED_READER_EXTENSION_ID } from "./id";

export const metadata: Metadata = {
  title: "Install the Covered reader",
};

const STORAGE_SNIPPET = COVERED_READER_EXTENSION_ID
  ? `localStorage.setItem("covered_extension_id", "${COVERED_READER_EXTENSION_ID}")`
  : `localStorage.setItem("covered_extension_id", "PASTE_ID")`;

const CARD = "rounded-xl border border-line bg-panel px-5 py-5";
const STEPS = "mt-4 list-decimal space-y-4 pl-5 text-sm leading-relaxed";

export default function ExtPage() {
  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b border-line px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-wrap items-end justify-between gap-4">
          <div>
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Covered
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Install the Covered reader</h1>
            <p className="mt-1 text-sm text-muted">Search reads Google Shopping in your own browser session.</p>
          </div>
          <Link href="/" className="text-sm text-muted hover:text-foreground">
            ← Back to the shop
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <section className={`${CARD} flex flex-wrap items-center justify-between gap-5`}>
          <div>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-muted">Works in</span>
              <span className="flex items-center gap-1.5">
                <BrowserIcon browser="brave" /> Brave
              </span>
              <span className="flex items-center gap-1.5">
                <BrowserIcon browser="chrome" /> Chrome
              </span>
              <span className="flex items-center gap-1.5">
                <BrowserIcon browser="firefox" /> Firefox
              </span>
            </p>
            <p className="mt-2 text-sm text-muted">This page cannot install it for you; browsers block that.</p>
          </div>
          <a
            href="/ext/covered-reader.zip"
            className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-background hover:brightness-110"
          >
            Download extension (.zip)
          </a>
        </section>

        <section className={CARD}>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <BrowserIcon browser="brave" className="h-5 w-5" />
            <BrowserIcon browser="chrome" className="h-5 w-5" />
            Brave or Chrome
          </h2>
          <ol className={STEPS}>
            <li>
              Open your browser&apos;s extensions page
              <span className="text-muted"> (not a link — paste it into the address bar):</span>
              <span className="mt-2 flex flex-col gap-2">
                <span className="flex items-center gap-2">
                  <BrowserIcon browser="brave" />
                  <span className="w-14 text-muted">Brave</span>
                  <CopyText value="brave://extensions" />
                </span>
                <span className="flex items-center gap-2">
                  <BrowserIcon browser="chrome" />
                  <span className="w-14 text-muted">Chrome</span>
                  <CopyText value="chrome://extensions" />
                </span>
              </span>
            </li>
            <li>Turn on Developer mode.</li>
            <li>
              Unzip the download. Click <strong>Load unpacked</strong> and select the unzipped folder (the one that
              contains <code>manifest.json</code>).
            </li>
            <li>Reload Covered and search.</li>
          </ol>
          {COVERED_READER_EXTENSION_ID ? (
            <div className="mt-5 rounded-lg border border-line bg-panel-raised px-4 py-3 text-sm">
              <p className="text-muted">
                Only if search still says the reader is not installed: the extension id should read
              </p>
              <p className="mt-2">
                <CopyText value={COVERED_READER_EXTENSION_ID} />
              </p>
              <p className="mt-2 text-muted">
                If the card shows a different id, run this in the console on{" "}
                <code className="text-foreground">https://covered.kawuc.uk</code> and reload:
              </p>
              <p className="mt-2">
                <CopyText value={STORAGE_SNIPPET} />
              </p>
              <p className="mt-2 text-muted">
                For local <code>pnpm dev</code>, set <code className="text-foreground">NEXT_PUBLIC_COVERED_EXTENSION_ID</code>{" "}
                in <code>.env.local</code> and restart.
              </p>
            </div>
          ) : null}
        </section>

        <section className={CARD}>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <BrowserIcon browser="firefox" className="h-5 w-5" />
            Firefox
          </h2>
          <p className="mt-1 text-sm text-muted">Firefox 121 or newer. No extension id needed.</p>
          <ol className={STEPS}>
            <li>
              Open the debugging page
              <span className="text-muted"> (not a link — paste it into the address bar):</span>
              <span className="mt-2 flex items-center gap-2">
                <BrowserIcon browser="firefox" />
                <CopyText value="about:debugging#/runtime/this-firefox" />
              </span>
            </li>
            <li>
              Click <strong>Load Temporary Add-on…</strong> and pick the downloaded <code>.zip</code>, or{" "}
              <code>manifest.json</code> inside the unzipped folder.
            </li>
            <li>Reload Covered and search.</li>
            <li>
              If search still says the reader is not installed, open <CopyText value="about:addons" />, choose
              Covered reader → <strong>Permissions</strong>, and allow <code>www.google.com</code> and this site.
            </li>
          </ol>
          <p className="mt-4 text-sm text-muted">
            Firefox removes temporary add-ons when it restarts; load it again the same way. Its warnings about{" "}
            <code>key</code> and <code>externally_connectable</code> are Chrome-only settings and harmless.
          </p>
        </section>

        <section id="pair" className={CARD}>
          <h2 className="text-base font-semibold tracking-tight">Pair your phone (or another browser) to this reader</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The extension keeps working with the laptop page closed. Once paired, a search on your phone, in
            Safari, or on any browser without the extension queues a job; the Brave with the reader picks it up
            within a minute (usually seconds), reads Google Shopping in your own session, and posts the offers
            back. Both devices are the same Covered user: same wallet, memory, limits and orders.
          </p>
          <ol className={STEPS}>
            <li>
              In Brave, click the <strong>Covered reader</strong> icon in the toolbar. The popup shows a 6-character
              pair code and whether the reader is connected. Codes last 10 minutes and work once.
            </li>
            <li>
              On the phone, open the Covered app and enter the code under <strong>Pair</strong>. On another browser,
              type it here:
              <PairForm />
            </li>
            <li>
              Search as normal. The dashboard says <em>Reading Google Shopping on your paired browser…</em> while the
              job runs. If Google asks the Brave for a check, pass it once in a normal tab there and search again.
            </li>
          </ol>
          <p className="mt-4 text-sm text-muted">
            Keep Brave running (it can be minimised). The reader polls every minute even when no Covered tab is open,
            and holds a 20-second long-poll while it is awake. Up to 5 devices can pair; the oldest drops off when a
            sixth joins.
          </p>
        </section>
      </main>
    </div>
  );
}
