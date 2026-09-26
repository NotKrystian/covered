# Covered iOS

Native SwiftUI iPhone app for Covered, the UK shopping bot. Live API: https://covered.kawuc.uk.

The iPhone talks to the same Next.js server as the web app. It does **not** read Google Shopping in the user's session the way the Brave/Chrome extension does. Search goes to `POST /api/search`, which returns the server's snapshot or live Playwright result (or a typed challenge / no-offers error).

## Open

```bash
open ios/Covered/Covered.xcodeproj
```

Or regenerate the project after editing `ios/Covered/project.yml`:

```bash
cd ios/Covered && xcodegen generate
```

Xcode 15+ / Swift 5.10+. Bundle id `uk.kawuc.covered`. iPhone, portrait, iOS 17.

## Build and run

Simulator (iPhone 16 Pro is installed on this machine):

```bash
cd ios/Covered
xcodebuild -scheme Covered -destination 'platform=iOS Simulator,name=iPhone 16 Pro,OS=18.5' build
xcodebuild -scheme Covered -destination 'platform=iOS Simulator,name=iPhone 16 Pro,OS=18.5' test
```

Pin `OS=18.5`: `name=iPhone 16 Pro` alone resolves to the latest runtime, which has no 16 Pro.

In Xcode: choose **Covered** → an iPhone simulator → Run.

If no simulator runtime is installed, build for a generic device without signing:

```bash
xcodebuild -scheme Covered -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

## Base URL (localhost)

Default is `https://covered.kawuc.uk`. For a local Next server (`pnpm dev` on :3000), set UserDefaults key `covered.baseURL` to `http://localhost:3000` (or `http://127.0.0.1:3000`). ATS allows those two hosts only; arbitrary HTTP loads stay off.

From the debugger:

```
(lldb) po UserDefaults.standard.set("http://localhost:3000", forKey: "covered.baseURL")
```

`covered_uid` is an httpOnly cookie minted by the server. `APIClient` uses `URLSession` + `HTTPCookieStorage.shared` so it sticks across launches for that host.

## What runs where

| On the iPhone | On the server |
| --- | --- |
| UI, theme, haptics | Bedrock judge |
| Pound rule (`applyPremium`) | Wallet ledger, orders, memory |
| Client sort (agent A) | Google Shopping read (`/api/search`) |
| Payment gesture (agent C) | Approve debit + receipt |

Memory writes only on Approve (or an explicit override). Decide is read-only.

## Ownership

Three feature agents replace the stubs. Do not overwrite `Core/` or `App/` without asking the skeleton owner. Commit only your own paths.

| Agent | Owns | Folders |
| --- | --- | --- |
| A | Onboarding + Shop | `ios/Covered/Covered/Features/Onboarding/`, `…/Shop/` |
| B | Orders + Returns | `ios/Covered/Covered/Features/Orders/` |
| C | Wallet + Limits + Settings | `ios/Covered/Covered/Features/Wallet/`, `…/Settings/` |
| Shared | Models, API, pound rule, theme, app shell | `ios/Covered/Covered/Core/`, `ios/Covered/Covered/App/` |
