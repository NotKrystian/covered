import type { Metadata } from "next";
import Link from "next/link";
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
          extension for you; Brave blocks that.
        </p>

        <a
          href="/ext/covered-reader.zip"
          className="mt-6 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background hover:brightness-110"
        >
          Download extension (.zip)
        </a>

        {COVERED_READER_EXTENSION_ID ? (
          <section className="mt-8 rounded-lg border border-accent/40 bg-accent-soft px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted">Extension id</p>
            <p className="mt-1.5">
              <CopyText value={COVERED_READER_EXTENSION_ID} />
            </p>
            <p className="mt-2 text-sm text-muted">
              Load unpacked keeps this id because the manifest includes a <code>key</code>. Paste it
              if the card shows something else.
            </p>
          </section>
        ) : null}

        <ol className="mt-8 list-decimal space-y-4 pl-5 text-sm leading-relaxed">
          <li>
            Open{" "}
            <CopyText value="brave://extensions" />
            <span className="text-muted">
              {" "}
              (not a link — <code>brave://</code> will not navigate from https). Chrome:{" "}
            </span>
            <CopyText value="chrome://extensions" />
          </li>
          <li>Turn on Developer mode.</li>
          <li>
            Unzip the download. Load unpacked and select the unzipped folder (the one that contains{" "}
            <code>manifest.json</code>).
          </li>
          <li>
            Copy the extension ID from the card. On{" "}
            <code className="text-foreground">https://covered.kawuc.uk</code> run in the console:{" "}
            <CopyText value={STORAGE_SNIPPET} /> then refresh. For local{" "}
            <code>pnpm dev</code>, set{" "}
            <code className="text-foreground">NEXT_PUBLIC_COVERED_EXTENSION_ID</code> in{" "}
            <code>.env.local</code> and restart.
          </li>
        </ol>
      </main>
    </div>
  );
}
