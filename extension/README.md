# Covered reader

Manifest V3 extension that reads the Google Shopping grid (`udm=28`) from **your** signed-in Brave, Chrome or Firefox session. Covered cannot `fetch()` Google from the server (no cookies, CORS). This extension opens an inactive tab, extracts the first paint, and sends the offers back to the page.

It does not launch or CDP-attach a browser, and it does not solve captchas. A `/sorry/` page comes back as `{ error: "challenge" }`.

## Install (Brave)

1. Open `brave://extensions` (Chrome: `chrome://extensions`).
2. Turn on **Developer mode**, click **Load unpacked**, and select this `extension/` folder.
3. Copy the extension ID and paste it once as `NEXT_PUBLIC_COVERED_EXTENSION_ID` in `.env.local`, then restart `pnpm dev`. On https://covered.kawuc.uk you can paste the same ID in the browser console: `localStorage.setItem("covered_extension_id", "YOUR_ID")` and refresh.

This folder ships a `key` so Load unpacked should show id `hlllnaaelmdioofigcmnafmiimafhglf`. If yours differs, use the id Brave printed. The id only matters for the older direct-messaging path; the page bridge below needs none.

## Install (Firefox 121+)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `extension/manifest.json`. It stays loaded until Firefox restarts.
3. If Live grid still says "Install the Covered reader extension", open `about:addons` → Covered reader → **Permissions** and allow access to `www.google.com` and the Covered site you are on.

Firefox warns that it ignores `key` and `externally_connectable`; both are Chrome-only and harmless.

## How the page reaches the extension

Firefox has no `externally_connectable`, so `bridge.js` runs on the Covered app (`localhost:3000`, `127.0.0.1:3000`, `covered.kawuc.uk`) and relays `window.postMessage` requests to the background. Chrome and Brave use the same bridge; `externally_connectable` stays as a fallback for older builds of this extension.

## Remote reader: pair a phone or another browser (1.5.0)

The background worker also serves devices that do not have this extension. Click the toolbar icon: the popup shows a **6-character pair code** (from `POST /api/pair/start`, using this browser's `covered_uid` cookie), connection status, the last remote job, and **Poll now**. Enter the code on the phone (`POST /api/pair/claim`) or at `covered.kawuc.uk/ext#pair` in another browser; that device becomes the same Covered user.

How work flows: a client `POST`s `{ query }` to `/api/reader/jobs`. Alarm `covered-reader-poll` fires every minute and wakes the worker; while awake it holds a 20-second long-poll on `GET /api/reader/jobs/next?wait=20` (production host, then `localhost:3000` if a dev server is up). A job opens the same inactive `udm=28` tab, extracts offers with photos, `POST`s them to `/api/reader/jobs/:id/result`, and closes the tab. A Google check posts `{ error: "challenge" }`. One job at a time; nothing needs the Covered page open. Codes live 10 minutes and work once; at most 5 devices per user.

## What Live grid does

Covered sends `{ type: "search", query }` to this extension. A background tab opens `https://www.google.com/search?q=QUERY&udm=28&hl=en&gl=uk`, the content script waits for `product-viewer-entrypoint` or `div.mnr-c.pla-unit` (or a challenge), then the tab closes. The page POSTs the offers to `/api/search` as a live read.
