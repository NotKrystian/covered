# Covered for iPhone (`ios/CoveredPhone`)

Native SwiftUI port of the Covered web product. Pure SwiftUI + Foundation, no packages, no third-party SDKs. Every judgement, wallet debit, receipt and memory write happens on the server; the phone only calls the live API.

> A second iOS tree lives at `ios/Covered/` (another agent team's build, `Core/` + `Features/`). This folder is self-contained and does not share files with it. Both use bundle id `uk.kawuc.covered`, so installing one on a simulator replaces the other.

## Open and run

```bash
cd ios/CoveredPhone
xcodegen generate          # only after editing project.yml or adding files
open Covered.xcodeproj     # scheme "Covered", pick an iPhone simulator, Run
```

Command line (verified with Xcode 26.3, iOS 26.0 simulator runtime, iPhone 17):

```bash
cd ios/CoveredPhone
xcodebuild -project Covered.xcodeproj -scheme Covered \
  -destination 'platform=iOS Simulator,name=iPhone 17' build

UDID=$(xcrun simctl list devices available | grep 'iPhone 17 (' | head -1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/')
xcrun simctl boot "$UDID"
xcrun simctl install "$UDID" ~/Library/Developer/Xcode/DerivedData/Covered-*/Build/Products/Debug-iphonesimulator/Covered.app
xcrun simctl launch "$UDID" uk.kawuc.covered
```

Deployment target iOS 17. iPhone only, portrait, dark UI, one accent (`#5fd38a`, the `--accent` from `src/app/globals.css`, stored as the `AccentColor` asset).

## Base URL

Default `https://covered.kawuc.uk`. Change it on the **Settings** tab (presets: Live, `localhost:3000`). Stored in `UserDefaults` under `covered_base_url`. ATS allows local networking so `http://localhost:3000` works against `pnpm dev`.

Identity is the server's anonymous httpOnly `covered_uid` cookie. `CoveredAPI` uses one `URLSession` backed by `HTTPCookieStorage.shared`, which persists across launches, so the same uid follows every request. Nothing else about identity is stored on the phone. **Reset memory** (Settings) calls `DELETE /api/memory`, drops the cookie locally, and restarts onboarding as a new buyer.

## What is wired

| Screen | Endpoints |
| --- | --- |
| Onboarding (first launch, or `onboarded: false` from `GET /api/memory`) | `PATCH /api/memory` (name, settings, onboarded), `POST /api/wallet` (optional deposit) |
| Home | `POST /api/search { query }` → `POST /api/decide { query, settings, display_name, offers, grid }`; Fleece demo → `POST /api/decide { source: "fixture" }`; wallet pill → `GET/POST /api/wallet`; Change → `PATCH /api/memory` settings |
| Approve sheet | `POST /api/approve` (receipt minus id/created_at, plus `chosen_id`). `402` shows the shortfall. |
| Orders | `GET /api/orders`; per-order chat → `POST /api/orders/assist { order_id, message, history }` |
| Limits | `GET/POST/DELETE /api/limits` |
| Settings | base URL, `DELETE /api/memory`, memory summary from `GET /api/memory`, version |

Errors handled: `402` wallet short (shortfall line on the sheet), reader `ok:false` with `challenge` / `unknown` (honest card: "Google challenged the server; try the fleece demo or a snapshot query", with a one-tap fleece demo), `no_offers`, `timeout`, network, and the server's `{ error }` line on 4xx/5xx.

Models in `Covered/Models/Types.swift` mirror `src/lib/types.ts`, `src/lib/decision.ts` and `src/lib/memory/index.ts` with explicit `CodingKeys`. `Offer` and `Decision` encode zod's nullable-but-required fields as explicit `null` so a receipt round-trips through `ReceiptSchema`. Client sort (`Models/SortListings.swift`) is a port of `src/lib/sort-listings.ts`; the chosen row is pinned first for every sort.

## The pay gesture

The film's side-button double-click cannot be hooked on real hardware, so the sheet's pay control accepts **two taps within 600 ms** or a **long press** (haptics on each). While the wallet debits, the control morphs into a ring that closes; on success the ring fades and a check draws (`Screens/Approve/RingCheck.swift`). Springs only: `.spring(response: 0.35, dampingFraction: 0.85)`. No confetti.

## Deliberately not on the phone

- **Live Google grid.** The real shelf is read by the desktop MV3 reader extension in the user's own browser session. A phone cannot run it, so Home uses the server read (`/api/search`), which on most networks falls back to an exact-slug snapshot, or the four fleece fixtures. A Google challenge is shown, never bypassed.
- **Watch-and-buy checks.** Limits are stored and listed here, but the hourly re-read runs from the desktop extension (`/api/limits/run`). The Limits tab says so.
- **Judge, wallet, memory, pound rule.** All server-side; the app never compares pence or writes memory itself.
- **Card payments.** None. The wallet is the demo ledger on the memory item.
- **`/dev` three-panel and trace.** The Home screen shows only `mode · N judged` and a `learned` chip; the full trace stays on the web `/dev`.

## Debug launch arguments (Debug builds only)

Used for screenshots and UI tests; see `App/LaunchFlags.swift`.

```
-demo-onboarded <name>   mark this uid onboarded and skip the flow
-demo-fixtures           run the fleece fixtures when Home appears
-demo-approve            open the pay sheet once the verdict lands (does not pay)
-demo-tab <shop|orders|limits|settings>
```

```bash
xcrun simctl launch "$UDID" uk.kawuc.covered -demo-onboarded Nick -demo-fixtures
```

## Layout

```
Covered/
  App/          CoveredApp, RootView (tabs), AppModel (memory/wallet/settings), LaunchFlags
  Networking/   CoveredAPI: one URLSession + cookie jar, every endpoint, photo source resolution
  Models/       Types (Codable mirrors), Money, SortListings
  Theme/        Palette, Motion.spring, button styles, PoundField, Chip, Haptics
  Components/   ListingPhoto (data URL / fixture / proxied thumb / CDN), SafariView
  Screens/      Onboarding, Home (ShopModel, ListingRow), Approve (sheet + RingCheck), Orders (+ AftercareChat), Limits, Settings
  Resources/    Assets.xcassets (AccentColor, LaunchBackground, AppIcon placeholder)
```
