import type { Metadata } from "next";
import Link from "next/link";
import { BrowserIcon } from "./BrowserIcon";
import { CopyText } from "./CopyText";
import { COVERED_READER_EXTENSION_ID } from "./id";

export const metadata: Metadata = {
  title: "Install the Covered reader",
};

const STORAGE_SNIPPET = COVERED_READER_EXTENSION_ID
  ? `localStorage.setItem("covered_extension_id", "${COVERED_READER_EXTENSION_ID}")`
  : `localStorage.setItem("covered_extension_id", "PASTE_ID")`;

export default function ExtPage() {
  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b border-line bg-panel px-5 py-2.5 text-sm">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between gap-4">
          <span className="font-semibold tracking-tight text-foreground">Covered</span>
          <Link href="/" className="text-muted hover:text-foreground">
            ← Back
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Install the Covered reader</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Live grid reads Google Shopping in your browser session. This page cannot install the
          extension for you; browsers block that.
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <span>Works in</span>
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

        <a
          href="/ext/covered-reader.zip"
          className="mt-6 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:brightness-110"
        >
          Download extension (.zip)
        </a>

        {COVERED_READER_EXTENSION_ID ? (
          <section className="mt-8 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted">
              Extension id
              <span className="normal-case tracking-normal">·</span>
              <BrowserIcon browser="brave" className="h-3.5 w-3.5" />
              <BrowserIcon browser="chrome" className="h-3.5 w-3.5" />
              <span className="normal-case tracking-normal">Brave and Chrome only</span>
            </p>
            <p className="mt-1.5">
              <CopyText value={COVERED_READER_EXTENSION_ID} />
            </p>
            <p className="mt-2 text-sm text-muted">
              Load unpacked keeps this id because the manifest includes a <code>key</code>. Paste it
              if the card shows something else.
            </p>
          </section>
        ) : null}

        <h2 className="mt-10 flex items-center gap-2 text-base font-semibold tracking-tight">
          <BrowserIcon browser="brave" className="h-5 w-5" />
          <BrowserIcon browser="chrome" className="h-5 w-5" />
          Brave or Chrome
        </h2>
        <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm leading-relaxed">
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
            Unzip the download. Load unpacked and select the unzipped folder (the one that contains{" "}
            <code>manifest.json</code>).
          </li>
          <li>
            Refresh this site and use Live grid. Only if it still asks you to install the extension:
            copy the extension ID from the card. On{" "}
            <code className="text-foreground">https://covered.kawuc.uk</code> run in the console:{" "}
            <CopyText value={STORAGE_SNIPPET} /> then refresh. For local{" "}
            <code>pnpm dev</code>, set{" "}
            <code className="text-foreground">NEXT_PUBLIC_COVERED_EXTENSION_ID</code> in{" "}
            <code>.env.local</code> and restart.
          </li>
        </ol>

        <h2 className="mt-10 flex items-center gap-2 text-base font-semibold tracking-tight">
          <BrowserIcon browser="firefox" className="h-5 w-5" />
          Firefox
        </h2>
        <p className="mt-2 text-sm text-muted">Firefox 121 or newer. No extension ID needed.</p>
        <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm leading-relaxed">
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
          <li>Refresh this site and use Live grid.</li>
          <li>
            If it still asks you to install the extension, open <CopyText value="about:addons" />, choose
            Covered reader → <strong>Permissions</strong>, and allow <code>www.google.com</code> and this
            site.
          </li>
        </ol>
        <p className="mt-4 text-sm text-muted">
          Firefox removes temporary add-ons when it restarts; load it again the same way. Its warnings about{" "}
          <code>key</code> and <code>externally_connectable</code> are Chrome-only settings and harmless.
        </p>
      </main>
    </div>
  );
}
