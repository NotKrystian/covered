# Covered reader

Manifest V3 extension that reads the Google Shopping grid (`udm=28`) from **your** signed-in Brave/Chrome session. Covered cannot `fetch()` Google from the server (no cookies, CORS). This extension opens an inactive tab, extracts the first paint, and sends the offers back to the page.

It does not launch or CDP-attach a browser, and it does not solve captchas. A `/sorry/` page comes back as `{ error: "challenge" }`.

## Install (Brave)

1. Open `brave://extensions` (Chrome: `chrome://extensions`).
2. Turn on **Developer mode**, click **Load unpacked**, and select this `extension/` folder.
3. Copy the extension ID and paste it once as `NEXT_PUBLIC_COVERED_EXTENSION_ID` in `.env.local`, then restart `pnpm dev`. On https://covered.kawuc.uk you can paste the same ID in the browser console: `localStorage.setItem("covered_extension_id", "YOUR_ID")` and refresh.

This folder ships a `key` so Load unpacked should show id `hlllnaaelmdioofigcmnafmiimafhglf`. If yours differs, use the id Brave printed.

## What Live grid does

Covered sends `{ type: "search", query }` to this extension. A background tab opens `https://www.google.com/search?q=QUERY&udm=28&hl=en&gl=uk`, the content script waits for `product-viewer-entrypoint` or `div.mnr-c.pla-unit` (or a challenge), then the tab closes. The page POSTs the offers to `/api/search` as a live read.
