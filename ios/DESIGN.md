# Covered iOS — design spec from the product film

Source of truth: `presentation/covered-film.html` (in-phone UI only). Crops are `#screen` stills at 2× (860×1860 px), camera flattened to 1:1 so the whole 430×930 film screen is visible. Paths are relative to this file.

**Scale.** Film screen is **430 × 930 CSS px**, corner radius **58 px**. Map width 430 → **393 pt** (iPhone 16 Pro).

```
pt = film_px × (393 / 430)     // k = 0.916279
```

Round layout to the nearest 0.5 pt. Type sizes below are already rounded. Height 930 × k ≈ **851.5 pt** (16 Pro is 852 — treat as full screen). Screen corner radius 58 × k ≈ **53 pt**; on device use the system continuous display corner, do not draw a fake bezel.

Phone chrome in the film (not in-app): body 456×956 px, radius 71, inset 13 px around the screen; camera scale 1.0–1.92 about a point on the screen. Ignore for layout; the crops already undo zoom.

---

## 1. Tokens

### Colour

| Token | Hex | Where |
|---|---|---|
| `stage` | `#ebe8e2` | Film canvas *behind* the phone. **Not** an in-app fill. Do not paint the screen this colour. |
| `screen` | `#ffffff` | App background. The phone interior is white, not beige. |
| `ink` | `#0b0b0b` | Wordmark, prices, approve fill, tab pill, send, handle, chosen outline, check stroke, return-ring arc, sum rule, alert fill. |
| `inkSoft` | `#111111` / `#121212` | Body copy on white (`#111` on `body`, `#121212` on captions). Use `#111111` for primary text. |
| `secondary` | `#6f6d67` | Merchant, delivery, “Wallet” label, gap/meter labels, tracker labels (idle). |
| `tertiary` | `#8a877f` | Placeholder (“Message Covered”), inactive tab, “of” in the meter, “was £…”, confirm hint, typing dots. |
| `chipText` | `#5e5c56` | Neutral chip copy (`chip.n`). |
| `mutedLine` | `#a3a19b` | Price strike on a rejected row. **Not red.** |
| `rejectedInk` | `#a3a19b` → mix toward `#111` | Rejected title/price: lerp `#111111` → `#a3a19b` (film greys to ~`#a3a19b` at full reject). Photo: grayscale 1 + opacity 0.55. |
| `accent` | `#5fd38a` | Brand dot, Covered-pick dot, meter fill (in-budget), tracker nodes reached, scan line, success-disc fill, checkmarks *inside* dark chips. **Never a button fill. Never a price colour. Never a tab tint fill.** |
| `accentInk` | `#0e2b19` | Copy + check stroke on a green rights chip. |
| `chipGood` | `#e2f6e9` | Rights / “14-day cancellation” chip fill. |
| `chipNeutral` | `#efeeea` | “not the item”, “private sale”, “ships from Hong Kong”. |
| `chipDark` | `#0b0b0b` | Lightbox “case only · no phone” (white 16 / 540). |
| `composer` | `#f0efec` | Search field, typing-dots bubble. |
| `panel` | `#f3f2ef` | Wallet pill, memory chip, order-detail / compact-row surface (`S2`/`S6`/`S7`). |
| `photoHole` | `#e8e6e1` | Photo placeholder before the jpeg lands. |
| `track` | `#e6e4df` | Premium track, sum card inset stroke. |
| `trackIdle` | `#dddbd5` | Delivery rail + idle nodes. |
| `divider` | `#ebe9e4` | Pay-sheet rules. |
| `dividerStrong` | `#e2e0da` | Order-detail rules; return-ring track. |
| `hairline` | `#e7e5e0` | Default card inset stroke (1 px film). |
| `chosenStroke` | `#0b0b0b` | Chosen card inset 2.5 px. |
| `grabber` | `#d9d7d1` | Sheet handle. |
| `backdrop` | `#000000` @ **38%** | Dim behind the pay sheet. No blur on the dim itself. |
| `alertInk` | `#0b0b0b` | Price-drop card. |
| `alertBody` | `#dcdad4` | Alert subtitle. |
| `alertMeta` | `#9a978f` | Alert merchant line. |
| `memChip` | `#232323` | Identity ticks on the black alert (`orange` / `256GB` / `new` / `UK trader`). |
| `saveChip` | `#5fd38a` on `#0b0b0b` type | “clears your £25”. |
| `battery` | `#111111` | Status-bar battery (system status bar is fine). |

No other greens. No red. No system blue. No gradients on chrome. No glows.

### Corner radii (pt = film_px × k, then rounded)

| Component | Film px | pt |
|---|---|---|
| Screen (system) | 58 | 53 |
| Card / order row | 22 | 20 |
| Photo on a list card | 16 | 14.5 |
| Photo on order detail | 18 | 16.5 |
| Photo on compact row | 14 | 13 |
| Composer field + send | 28 | 25.5 |
| Typing-dots bubble | 22 | 20 |
| Rights / neutral chip | 12 | 11 |
| Covered-pick pill | 14 | 13 |
| Approve button | 38 | 35 |
| Pay sheet | 36 | 33 |
| Sheet grabber | 3 | 2.5 |
| Wallet / memory chip | 19 / 21 | 17.5 / 19 |
| Tab pill | 20 | 18.5 |
| Premium track | 7 | 6.5 |
| Premium handle | 22 | 20 |
| Alert / sum card | 26 | 24 |
| Lightbox (open) | 26 | 24 |
| Save chip | 15 | 14 |
| Brand / pick / alert dots | 3.5–5 | 4 |

### Spacing (film → pt)

Horizontal inset from screen edge to content: **24 px → 22 pt**. Card stack inset 24 px. Card-to-card gap in the list: slot 180 px → **165 pt** (card 170 px + 10 px air). Two-up gutter: 221 − 24 − 185 = 12 px → **11 pt**.

Scale: 8 / 12 / 16 / 24 / 28 film px → **7.5 / 11 / 14.5 / 22 / 25.5 pt**. Prefer these, not the app’s current 8 / 16 / 24.

### Shadow

**None** on in-screen cards, chips, the tab bar, or the approve button. Cards are a 1 px (default) or 2.5 px (chosen) *inset* stroke, not a drop shadow.

Exceptions (film only, do not copy into the app chrome):

- Phone bezel: `0 44px 70px -24px rgba(70,52,30,0.30)` — stage, not UI.
- Lightbox: `0 0 0 1px #e7e5e0`.
- Sum card: `inset 0 0 0 1.5px #e6e4df`.
- Finger (demo only): ignore.

### Strokes

| Use | Film | pt |
|---|---|---|
| Card default inset | 1 | 1 |
| Card chosen inset | 2.5 | 2.5 |
| Price strike | 2.5, `#a3a19b`, origin left | 2.5 |
| Scan line | 2, `#5fd38a` | 2 |
| Send chevron | 2.2, white, round cap | 2 |
| Sheet / detail hairline | 1, `#ebe9e4` / `#e2e0da` | 1 |
| Sum rule | 1.5, `#0b0b0b` | 1.5 |
| Success ring | 7, then fills green | 6.5 |
| Success check | 8, `#0b0b0b`, round | 7.5 |
| Return ring (hero) | 12, `#0b0b0b` on `#e2e0da` | 11 |
| Return ring (compact) | 5 | 4.5 |
| Delivery rail | 4, `#dddbd5` / `#5fd38a` | 3.5 |
| Battery outline | 1.6 | system |
| Chip check | 3, `#0e2b19` or `#5fd38a` | 2.5 |

---

## 2. Type

**Film family:** Geist variable, weights 100–900, OFL. File lives at `presentation/assets/fonts/Geist-Variable.woff2`.

**Recommend bundling Geist.** The film’s character is the 620–660 weights and the −0.03 to −0.045 em tracking. SF Pro Medium/Semibold is a lawful fallback but reads wider and softer. If you bundle Geist, ship the OFL variable face (or static 400/500/600/700) and keep SF Pro as the system fallback. Do not use New York, Rounded, or monospaced *design* except pairing codes.

Money always uses **tabular lining numerals** (`font-variant-numeric: tabular-nums` / `.monospacedDigit()`). Format `£1,099.00` with a thin space or none before the amount; the film uses `£` flush to the digits.

### Styles (film px → implementable pt)

| Style | Film | pt / SF weight | Tracking | Line | Use |
|---|---|---|---|---|---|
| Wordmark | 25 / 660 / −0.035 em | 23 / **bold** | −0.8 | 1.0 | “Covered” + 6.5 pt accent dot |
| Status | 15 / 600 / −0.01 em | 14 / semibold | −0.15 | — | Time (system status bar OK) |
| Wallet label | 13 / 500 | 12 / medium | 0 | — | “Wallet” in the header chip |
| Wallet amount | 18 / 620 / −0.01 em | 16.5 / semibold | −0.2 | — | `£2,000.00` |
| Composer placeholder | 17 / 400 | 15.5 / regular | 0 | — | “Message Covered”, `#8a877f` |
| Sent bubble | 19 / 520 / −0.01 em | 17.5 / medium | −0.2 | 23 | Query on `#0b0b0b` |
| List count | 15 / 500 | 14 / medium | 0 | — | “4 listings” / “2 left”, `#6f6d67` |
| Price (hero) | 32 / 650 / −0.03 em | **29 / bold** | −0.9 | 33 | Card price. This is the loudest number on Shop. |
| Was-price | 15 / 500, strike | 14 / medium | 0 | — | `was £1,199`, `#8a877f` |
| Title | 15 / 520 | **14 / medium** | 0 | 18 | Two lines max |
| Merchant | 14 / 400 | 13 / regular | 0 | 16.5 | `#6f6d67` |
| Chip | 13 / 540 | 12 / medium | 0 | 15.5 | 6.5 × 9 pt padding (7×10 film) |
| Pick | 13 / 600 | 12 / semibold | 0 | — | “Covered pick” |
| Gap / meter label | 15 / 500 | 14 / medium | 0 | — | “Gap”, “Rights premium” |
| Gap / meter value | 18–19 / 600–640 | 16.5–17.5 / semibold | −0.2 | — | `£1,099 − £1,050 = £49` |
| Handle | 16 / 600 | 14.5 / semibold | 0 | — | “Pay up to £60”, white on ink |
| Verdict lead | 19 / 640 / −0.015 em | 17.5 / semibold | −0.3 | — | `£49 ≤ £60 · shop wins` |
| Verdict body | 16 / 400 | 14.5 / regular | 0 | 19 | `#5e5c56` |
| Approve | 20 / 640 / −0.01 em | 18.5 / semibold | −0.2 | — | `Approve · £1,099.00` |
| Sheet label | 16 / 500 | 14.5 / medium | 0 | — | “Covered wallet”, “Total” |
| Sheet amount | 23 / 620 | 21 / semibold | −0.2 | — | Wallet on the sheet |
| Sheet total | 28 / 660 / −0.02 em | 25.5 / bold | −0.5 | — | Total |
| Sheet hint | 15 / 500 | 14 / medium | 0 | — | “Confirm with Face ID”, `#8a877f` |
| Row id | 20 / 640 | 18.5 / semibold | −0.4 | — | `#CV-4821 · £1,099.00` |
| Row meta | 14 / 400 | 13 / regular | 0 | 16.5 | “Paid · Brightwell Electrical” |
| Detail title | 20 / 640 | 18.5 / semibold | −0.4 | — | Product name |
| Tracker label | 15 / 560 | 14 / medium | 0 | — | Placed / Dispatched / Delivered |
| Ring number | 46 / 660 / −0.03 em | **42 / bold** | −1.2 | 42 | Days left |
| Ring caption | 14 / 500 | 13 / medium | 0 | — | “days left” |
| Alert title | 19 / 640 / −0.02 em | 17.5 / semibold | −0.35 | — | White on ink |
| Alert body | 17 / 400 | 15.5 / regular | 0 | 20 | `#dcdad4` |
| Sum label | 15 / 500 | 14 / medium | 0 | — | Row names |
| Sum value | 23 / 600 | 21 / semibold | −0.2 | — | Line amounts |
| Sum result | 34 / 680 / −0.025 em | **31 / bold** | −0.8 | — | `= £195.00` |
| Money kept | 64 / 680 / −0.04 em | **58.5 / bold** | −2.3 | 64 | Hero figure |
| Memory chip | 17 / 560 | 15.5 / medium | 0 | — | “you pay for rights” |
| Tab | 16 / 600 | 14.5 / semibold | 0 | — | Chat / Orders |

Geist 520 ≈ SF Medium. Geist 620–640 ≈ SF Semibold. Geist 650–680 ≈ SF Bold. Do not use `.title` / `.headline` / `.body` system styles — they will fight these sizes.

---

## 3. Components

Every layout below is **screen-left, screen-top**, film px first, then pt.

### Status bar + header

```
[ 22pt ] 16:30                    ●                    [battery]
[ 53pt ] Covered●                          (Wallet  £2,000.00)
```

- Time 14 pt semibold, left 31 pt, top 14 pt. System status bar is acceptable; if you draw one, match this.
- Wordmark left **22 pt**, top **53 pt**. Accent dot 6.5×6.5 pt, 4 pt radius, `#5fd38a`, 2 pt after the last letter.
- Wallet chip (Orders / post-approve only): height **35 pt**, horizontal pad 13 pt, radius 17.5, fill `#f3f2ef`. Label 12 / `#6f6d67` + amount 16.5 / `#111` tabular. Right inset 20 pt, top 51 pt.
- No large `navigationTitle("Shop")`. The wordmark *is* the title.

Crop: `design-ref/18-header-wallet.png`, `design-ref/01-chat-bubble.png`.

### Composer (search / chat field)

`design-ref/16-composer.png`, `design-ref/01-chat-bubble.png`

```
[ 15pt from left ] [ field 302 × 51, r=25.5, #f0efec ] [ 6pt ] [ send 51×51, r=25.5, #0b0b0b ]
                   placeholder 15.5 / #8a877f, pad 15.5 × 20
                                                                 ↑ white 2pt stroke, 22×22 view
```

Film: field `16,792,330×56,r28`; send `358,792,56×56,r28`. Bottom clearance above the tab pill ≈ 37 pt.

- **Idle:** placeholder “Message Covered” (Shop: the last query, or “Message Covered”).
- **Filled:** ink 15.5 / medium, same padding.
- **Send:** black circle, white up-chevron (`M12 19V5 M5.5 11.5 12 5l6.5 6.5`, stroke 2). Press scale **0.92** (`press` spring: response 0.15, damping 0.90).
- **Do not** put a green “Search” capsule on a black bar.

### Sent bubble + typing dots

`design-ref/01-chat-bubble.png`

- Sent query morphs from the field: surface `S0` `#f0efec` r26 → `S1` `#0b0b0b` r26, 330×78 film → **302 × 71 pt**, left 77 pt when it sits as a bubble (`S1` x=84). Type 17.5 / medium / −0.2, white, 2-line, pad ~20 pt.
- Typing: 78×44 film → **71 × 40 pt**, r20, `#f0efec`, three 7.5 pt dots `#8a877f`. Phase: 2.4 Hz, 0.9 rad stagger, translateY −4 px × sin, opacity 0.45–1. Enter: scale from 0.7 + 9 pt up (`enter` / `soft`).
- Blur-swap: `show()` default blur **7 px** (~6.5 pt) as presence goes 0→1. Use that, not a hard cut.

Motion: field/send `enter` 0.33 / 0.80; bubble `soft` 0.50 / 0.84; dots enter with `sc: 0.3, dy: 10`.

### Listing card (list)

`design-ref/02-listing-cards.png`

```
┌─ 349.5 × 155.5, r=20, #fff, inset 1 #e7e5e0 ─────────────────┐
│ 13pt │ [ photo 130×130, r=14.5, #e8e6e1, cover ] │           │
│      │                                            │ 29pt £    │
│      │                                            │ 14pt title│
│      │                                            │ 13pt shop │
└──────────────────────────────────────────────────────────────┘
```

Film: card `24, y, 382×170, r22`. Photo `14,14,142×142,r16`. Type block `left 170, top 14, width 198`.

Content order: **photo → price → title → merchant**. Price is left-aligned in the text column, not trailing. “was £…” sits *after* the price on the same baseline, 7 pt gap, struck, `#8a877f`.

- Photo: `scaledToFill`, crop toward the product. Placeholder `#e8e6e1`. Lands with blur 14→0 and scale 1.04→1 (`soft`).
- Ad: same card. If `section == .sponsored`, a `chip.n` “Ad” (not a green capsule).
- Delivery / returns do **not** live in the list row. They appear as chips after judgement.

**States**

| State | Fill | Stroke | Type | Photo | Extra |
|---|---|---|---|---|---|
| Default | `#fff` | inset 1 `#e7e5e0` | ink / secondary | colour | — |
| Loading | `#fff` | inset 1 | ink | `#e8e6e1` hole, image opacity 0 | count label “4 listings” |
| Chosen | `#fff` | inset **2.5 `#0b0b0b`** | ink | colour | `Covered pick` pill |
| Rejected | `#fff` | inset 1 | `#a3a19b`, price struck 2.5 `#a3a19b` | grayscale 1, opacity 0.55 | `chip.n` reason |
| Press (approve morph) | → ink | stroke fades | — | fades | card *is* the button |

Chosen pick (`design-ref/05-premium-slider.png`, `design-ref/20-chosen-pick.png`): `16,16` film, height 28 → **26 pt**, pad 8 / 10, r13, `#0b0b0b` + 6.5 pt accent dot + “Covered pick” 12 / semibold / white.

Rejected (`design-ref/03-mislisting-strike.png`): strike is a **2.5 pt bar through the price only**, transform-origin left, spring `soft`. Chip “not the item” / photo reason, `#efeeea` / `#5e5c56`. Header count becomes “3 left”.

**Two-up (rights beat)** — `design-ref/04-rights-chips-meter.png`

After the overseas row is dropped, private + shop sit side by side:

- Each **169 × 347 pt** (185×380 film), r20.
- Photo becomes a **banner**: inset 7.5, height 150, width = card − 14.5, r14.5.
- Price + merchant move **under** the photo (`ct` block, top 168 film → 154 pt).
- Chip pinned to the bottom: 11 pt inset, width 147, “private sale · as described only” (`chip.n`) vs “14-day cancellation · 30-day fault refund” (`chip.g`).
- Width/x use `snap` (0.24 / 0.82); height/y use `ui` (0.35 / 0.80) so columns settle before they grow.

Motion: cards land with `land` (0.42 / 0.80), `dy: 60, sc: 0.04, blur: 6`. Rejected card height → 0 with `soft`. Chosen outline lerps 1→2.5 as the winner flips (`snap`).

### Lightbox (mislisting photo)

`design-ref/17-lightbox.png`

Photo springs from the card thumb `38,192,142×142,r16` → `24,150,382×382,r26` (`soft`). Veil `#f3f2ef` @ 92%, r30, over the list (`12,124,406×736`). Black chip bottom-left: “case only · no phone”, 16 / 540, pad 8×13, r15. Then it springs back and the row greys + strikes.

### Rights chip

`design-ref/04-rights-chips-meter.png`, `design-ref/06-approve-button.png`, `design-ref/09-order-row.png`

```
[ r11  fill #e2f6e9  ]  [check 12pt, stroke 2.5 #0e2b19]  14-day cancellation · 30-day fault refund
                         copy 12–14 / 540 / #0e2b19
```

Padding 6.5×9 (chip) or 8×12 (row chip) or 8×12 (sheet, 14 / medium). Check is a 3-wide stroke path `M4.5 12.5l5 5L19.5 7`, never a filled SF Symbol in green-on-green.

Neutral chips use the same geometry, fill `#efeeea`, type `#5e5c56`, no check.

### Premium meter + slider

`design-ref/05-premium-slider.png`

```
Gap                                              £1,099 − £1,050 = £49
Rights premium                                   £49  of  £60
[ ########## fillG #5fd38a #### |---- fillO #b9b6ae ---- ]
                                ▲ 2.3×27.5 ink marker
                         [ Pay up to £60 ]   139 × 40, r20, #0b0b0b
£49 ≤ £60 · shop wins
£49 buys 14-day cancellation and a 30-day fault refund.
```

Film: track `36,636,358×14,r7`; handle 152×44, r22, y 664; marker 2.5×30 at y 628. In pt: track **327.5 × 13**, r6.5; handle **139 × 40**; marker **2.5 × 27.5**.

- Track fill: green from 0 to `min(gap, premium)`; grey (`#b9b6ae`) from premium to gap when the gap beats the cap.
- Handle is a **black capsule labelled “Pay up to £n”**, not a system thumb. It stays under the marker (offset so “Pay” is the grab). Press scale 0.95.
- Steps: **whole pounds**. Range in the film 0…80; the app’s stored cap can stay 0…£30 but the *control* must look like this, not `Slider`.
- Verdict swaps with blur 6 + 7 pt rise (`ui`). Copy is the **pound rule in English**, not a marketing line.
- Drag spring is critically damped (`drag` 0.45 / 1.00) so the value never overshoots. Money on the labels uses `money` 0.39 / 1.00 and snaps to the pence.

**Do not** use a green system `Slider` under a “Pay up to £x” caption.

### Approve button

`design-ref/06-approve-button.png`

Full-width **349.5 × 69.5 pt**, r35, fill `#0b0b0b`, type 18.5 / semibold / white / tabular: `Approve · £1,099.00`.

Sits under a summary: 80.5 pt thumb r14.5, merchant 19 / semibold, product 14 / `#6f6d67`, rights chip.

Morph: the **chosen card becomes this button** (`merge` 0.45 / 1.00). Colour snaps to ink (`snap`). Press scale **0.965**. The surface under the card dissolves (`exit` 0.21 / 0.95) once the rects match.

**Not** a 12×18 green capsule that says “Approve”.

### Pay sheet

`design-ref/07-pay-sheet.png`

```
                    [ grabber 36.5 × 4.5, r2.5, #d9d7d1 ]
Covered wallet                                      £2,000.00
──────────────── 1pt #ebe9e4 ────────────────
[66.5² r13 thumb]  iPhone 17 Pro Max          £1,099.00
                   Cosmic Orange · 256GB
                   Brightwell Electrical
────────────────
[ rights chip ]
Total                                              £1,099.00
              Confirm with Face ID
```

Film: `8,494,414×436,r36` → **379 × 399, r33**. Overlay `#000` @ 0.38. Enter `ui` + 18 pt rise.

App copy: **“Confirm with Face ID”** in the hint slot (film: “Confirm with the side button” + “Double-click to pay”). Same type 14 / `#8a877f`, centred. No Apple logo. No Face ID glyph. The confirm *action* is the system evaluatePolicy; the sheet itself has no second green button.

Wallet-short variant: same sheet, swap the hint for “Add £x to cover this listing.” and a black `Wallet` pill (same geometry as Approve). Do not restyle the sheet to a black card.

### Success check

`design-ref/08-check.png`

Sheet morphs to a **117 pt** disc (`S4` 128²). Ring stroke 6.5, `#ebe9e4` track then `#0b0b0b` arc (`ring` 0.52 / 1.00, dash 2πr). At the punch the disc **fills `#5fd38a`** (`snap`) and the track/arc fade. Check path `M40 66 L56 81 L89 47` in the 128 box, stroke **7.5**, `#0b0b0b` (not green). Then the disc morphs into the order row (`soft`).

App today: 56 pt green stroke on a black card. Wrong colour, wrong size, nothing morphs.

### Order row

`design-ref/09-order-row.png`, `design-ref/19-orders-tab.png`

```
┌─ 349.5 × 99, r20, #fff (or #f3f2ef after the expand) ─────────┐
│ 14.5 │ [66.5² r13]  #CV-4821 · £1,099.00     18.5 semibold     │
│      │              Paid · Brightwell Electrical  13 / #6f6d67 │
└────────────────────────────────────────────────────────────────┘
```

Then a rights chip underneath, 22 pt from the left: “Rights kept · 14-day cancellation · 30-day fault refund”.

Compact (post-delivery): **371.5 × 91.5**, `#f3f2ef`, r22. Thumb 62². Title `#CV-4821 · £1,099.00`. Meta “Delivered · 8 days left” **or** “return started · £1,099.00 refund pending” (blur-swap 5 pt, 5.5 pt rise).

**No black fill. No accent-green price.**

### Tracker

`design-ref/10-orders-tracker.png`

Film is a demo. **The app must not invent Placed → Dispatched → Delivered.** Keep the *drawing* if you ever have real events; until then show only states you know (e.g. “Paid” as the first node) and the existing “Tracking isn't connected yet” line in secondary, not a fake rail that walks itself.

When you do draw it:

- Rail 318×3.5, r2, `#dddbd5`, fill `#5fd38a` to the lead.
- Nodes 11 pt, idle `#dddbd5`, reached `#5fd38a`.
- Travelling pill: height 13, r6.5, `#0b0b0b`, width = lead−trail + 13. Lead uses `lead` 0.24 / 0.82; trail uses `trail` 0.52 / 0.90 (trail lags).
- Labels 14 / medium, idle `#a0a0a0`-ish (lerp 160→17), reached `#111`.

### 14-day return ring

`design-ref/11-return-ring.png`, compact on `design-ref/12-price-drop-alert.png`

Hero: centre of the detail card, r **58.5**, stroke **11**, track `#e2e0da`, arc `#0b0b0b` (not green), round cap, start −90°. Arc length = `daysLeft / 14`. Number **42 / bold** tabular + “days left” 13 / `#6f6d67`.

Compacts to the trailing edge of the order row: centre ~ (340, 159) film → r **20**, stroke **4.5**, same colours. Number hides (`soft`).

App today: 28 pt ring, stroke 3, **green** if open. Too small, wrong colour.

### Price-drop alert

`design-ref/12-price-drop-alert.png`

**371.5 × 179, r24, `#0b0b0b`.** This is the one place a full-bleed black card is correct.

```
● 6.5  Clear-out sale                         [64² thumb]
       same phone £899
       at another UK shop
       Parkside Tech · UK shop     13 / #9a978f
[ mchip ][ mchip ][ mchip ][ mchip ]
```

Title 17.5 / white. Body 15.5 / `#dcdad4`, 2 lines. Memory chips 31 pt tall, r15.5, `#232323`, 13 / medium / white, green check 12 pt. They pop with `snap`, scale from 0.75.

Lands `land` from +36 pt. At confirm it **morphs** to a compact order row (`#f3f2ef`, 91.5 tall, r22): “New order · £899.00”.

### Sum / ledger

`design-ref/13-sum.png`, `design-ref/14-memory-chip.png`

White card, inset 1.5 `#e6e4df`, r24, width 371.5. Rows 14 / `#6f6d67` leading, 21 / semibold tabular trailing. Rule 1.5 `#0b0b0b` grows from the right (`scaleX`). Result 31 / bold `= £195.00`. Save chip right-aligned, `#5fd38a` / `#0b0b0b`, 14 / semibold, r14.

Then the card **shortens** and the ledger blur-swaps to:

```
Money kept          14.5 / #6f6d67
£195.00             58.5 / bold, money spring (never overshoots)
[ Remembered  ● you pay for rights ]   #f3f2ef, 38.5 tall, r19
```

Memory chip: label 13 / `#6f6d67` + 6.5 pt accent dot + 15.5 / medium ink. Enter from −13 pt with blur 5 (`land`).

### Tab bar

`design-ref/15-tab-bar.png`, `design-ref/19-orders-tab.png`

Not `TabView` + SF Symbols.

```
           Chat                         Orders
        [######## pill ########]
```

- Two **text** tabs, 14.5 / semibold. Inactive `#8a877f`, active white because they sit on the pill.
- Pill: height **36.5**, r18.5, `#0b0b0b`. Width hugs the selected label (~108 pt for “Chat”, ~114 pt for “Orders”). Top ≈ 801 pt on a 852 screen (film y 875 / 930).
- Slide: left edge `trail`, right edge `lead` (or the reverse when going left) so the pill *stretches* then settles. Press scale 0.95.
- Film has two destinations. The app has Shop / Orders / Wallet / Settings. **Keep four**, but draw them as the same text + sliding ink pill (Shop · Orders · Wallet · Settings). Do not use `bag` / `shippingbox` / `creditcard` / `gearshape`. Wallet already has a header chip on Orders — Settings is a trailing wordmark-area control or the fourth tab, not a green-tinted system bar.

---

## 4. Screen map

Light mode only. Screen fill `#ffffff`. Tint = `#0b0b0b` for chrome, `#5fd38a` only where the film uses it.

### Onboarding (not in the film — derive)

One idea per screen. Large type (29 / bold, tracking −0.9 — the price style). Secondary 14.5 / `#6f6d67`. White screen, not `#ebe8e2`.

1. Name — underline 1 pt, accent only while focused.
2. Premium — the **film meter + handle**, not a stepper. Sentence: “Pay up to £10 more to keep UK buyer rights.”
3. Switch floor — same control, “Only switch inside 14 days if I still clear £8 after postage.”
4. Example — two mini cards (private vs shop) + one rights chip + one verdict line. No fleece-specific copy unless the query is the fleece.
5. Pair — composer-style field (not a black 22-radius block with canvas-coloured glyphs). Continue is the black 69.5 pt pill.
6. Deposit — chips like the memory chip (`#f3f2ef`, selected = ink text on `#5fd38a` is OK *only* for the selected £ amount, matching the film’s save chip). Primary “Save” is the **black** approve pill, not green.

Footer: “Back” 14 / `#6f6d67`. Continue = black pill, 18.5 / white. No green `CoveredPrimaryButtonStyle`.

### Shop

`design-ref/16-composer.png` → `01` → `02` → `03`/`17` → `04`/`05` → `06`

```
Covered●
[ composer ]
[ sent bubble + dots ]          // while deciding
4 listings                      // then 3 left / 2 left
[ card ]
[ card ]
[ meter + handle + verdict ]    // after two-up
[ Approve · £x ]                // chosen only, full width
[ Chat | Orders | … pill ]
```

Sort is a quiet 12 / `#6f6d67` menu (“Price”, “Brand”…) — no extra chrome. Limits (“Set a limit”) live in a ··· on the card, not a second primary button.

### Approve sheet

`design-ref/07-pay-sheet.png` → `08-check.png` → `09-order-row.png`

Present as a white sheet over 38% black. Face ID is the confirm. On success, morph sheet → green disc + black check → order row, then switch the tab pill to Orders.

### Orders list

`design-ref/09-order-row.png` + `15`/`19`

White screen. Header: wordmark + wallet chip (counting money, `money` spring). Rows as in §3. Empty state: 14.5 / `#6f6d67`, one sentence, no black card.

### Order detail + returns chat

`design-ref/10-orders-tracker.png`, `11-return-ring.png`

Panel `#f3f2ef`, r27.5 (film `S6` 406×736, r30). Thumb 91.5² r16.5. Title stack as in the film. Real tracker only. Hero ring, then compact when the price-drop / aftercare content arrives.

Returns chat (derived from the Shop bubble, not invented):

- User: `#0b0b0b`, 17.5 / medium / white, r20, max width ~70%.
- Assistant: `#f0efec`, 17.5 / medium / `#111`, r20. Draft-to-seller is a nested white card, inset 1 `#e7e5e0`, 14 / regular. “Copy” is a small ink pill, not a green capsule.
- Composer: same as Shop (warm field + black send). Chips “Return it” / “It's faulty” = `chip.n`.
- Do not use black assistant bubbles or `Color.white.opacity(0.7)` user bubbles.

### Wallet

Derive from the header chip + the sum card, not from a black bank-card.

- Balance: 58.5 / bold / `#111` on white, caption 14 / `#6f6d67` “Covered wallet”.
- Deposit chips: `#f3f2ef` idle, selected `#5fd38a` / `#0b0b0b` (save-chip language). Confirm deposit = black pill.
- History: white rows, 14 / ink, tabular amount. Hairline `#ebe9e4`.
- Limits: white 20-radius cards, 14 / medium query, 13 / `#6f6d67` “buy at or under £x”. Status chip = `chip.g` / `chip.n` (Watching / Filled / Paused / Wallet short). **No `#111` fill, no white-on-black body copy.**

### Settings

White grouped rows (`#fff` on `#fff` with 1 pt `#ebe9e4` rules), 14.5 / ink. Rights rows use the same pound handle as Shop, not a `Stepper`. Memory is the film memory chip under a 14 / `#6f6d67` “Remembered” label, plus the summary as 14.5 / `#111`. Reset is a **neutral** ink-outline button (“Reset memory”), never `role: .destructive` (that is system red). Server URL stays 12 / `#8a877f`.

---

## 5. Gap list

The tokens in `Theme.swift` already *name* some film colours (`canvas` `#ebe8e2`, `accent` `#5fd38a`, `dangerGrey` `#a3a19b`) and then the screens paint the **wrong surfaces** with them. The film’s in-phone background is **white**. `Color.canvas` is the *stage behind the phone*.

### `Core/Theme.swift`

- `canvas` is used as the app background. Film screen is `#ffffff`. Keep `#ebe8e2` only if you ever draw a device frame; add `screen = #ffffff`.
- Missing: `composer #f0efec`, `panel #f3f2ef`, `chipGood #e2f6e9`, `accentInk #0e2b19`, `hairline #e7e5e0`, `ink #0b0b0b` (current `ink` is `#111111` — close; film chrome is `#0b0b0b`).
- `Theme.radius = 22` is film-px, not pt (should be **20**). `radiusSmall = 12` is only for chips; approve is **35**.
- `Font.ui` / `Font.money` do not encode the film sizes or tracking.

### `Core/Motion.swift`

- One spring `response: 0.35, dampingFraction: 0.9`. Film `ui` is 0.35 / **0.80** (1.5% overshoot). Also need `snap` 0.24 / 0.82, `soft` 0.50 / 0.84, `land` 0.42 / 0.80, `enter` 0.33 / 0.80, `exit` 0.21 / 0.95, `press` 0.15 / 0.90, `money` 0.39 / 1.00, `ring` 0.52 / 1.00, `merge` 0.45 / 1.00, `lead` 0.24 / 0.82, `trail` 0.52 / 0.90.
- Blur-swap amount in the film is **7 px** (~6.5 pt), not a default `.blurReplace` with no dy.

### `Core/AppChrome.swift`

- `Theme.panel` / `panelRaised` = `Color.ink` (black). Film panels are `#f3f2ef` or `#fff`.
- `PrimaryButtonStyle`: green fill, ink type, r12, 16 / semibold. Film primary is **black, white type, r35, 18.5, 70 pt tall**.
- `QuietButtonStyle`: muted stroke. Film secondary is a text button in `#6f6d67`, no outline — or a `#f3f2ef` chip.

### `App/RootView.swift` + `Core/CoveredTabs.swift`

- `TabView` + `Label("Shop", systemImage: "bag")` etc., `.tint(Color.accent)`. Film tab bar is two (app: four) **text** labels and a sliding `#0b0b0b` pill. Accent-green selected icons are not in the film.

### `Features/Onboarding/OnboardingFlow.swift`

- Screen fill `Color.canvas` (`#ebe8e2`). Film screen is white.
- Headlines 32 / 28 / 20 — in the right family, but Continue is `CoveredPrimaryButtonStyle` **green**.
- Premium / switch use `PoundStepper` (black minus, green plus, 44 pt circles). Film uses the meter + “Pay up to £n” handle.
- Deposit chips: selected green, idle `ink.opacity(0.08)` — close to the save chip, but the primary Save is still green.
- Stepper minus is a **black circle with canvas-coloured minus** — that motif is the *send* button, not a stepper.

### `Features/Shop/ShopView.swift`

- Search is a **black** `Theme.radius` bar, field type `.foregroundStyle(Color.canvas)`, trailing green “Search”. Film: `#f0efec` pill + black send circle (`16-composer.png`).
- `navigationTitle("Shop")` inline. Film: wordmark + dot, no “Shop”.
- Results sit on `#ebe8e2` with 16 pt padding. Film: white, 22 pt inset.
- `premiumSlider` is a system `Slider`, tint accent, caption “Pay up to £x” in 16 semibold. Film: custom track + black handle + gap line + verdict (`05-premium-slider.png`).
- Loading / error states are **black rounded rects** with canvas-coloured type (`loadingState`, `errorState`). Film loading is empty white cards with `#e8e6e1` photo holes (`15-tab-bar.png`).
- Confirming dims the list to 0.15 and drops in `ApproveConfirm` — not a 38% black veil + white sheet.

### `Features/Shop/ListingCard.swift`

- Card fill `Color.ink`, type `Color.canvas`, r22. Film: **white**, ink type, r20, inset 1 `#e7e5e0`.
- Photo 72 pt, r10 (`OfferPhoto`). Film list photo **130 pt**, r14.5.
- Price 18 / semibold, trailing. Film price **29 / bold**, leading in the text column.
- Title 16 / medium, up to 3 lines, canvas-coloured. Film **14 / medium**, 2 lines, `#111`.
- Meta 13 / muted, merchant·delivery·returns jammed on one line. Film merchant only on the list; rights are chips.
- Chosen: 1.5 pt **accent** stroke + green “Chosen” capsule. Film: 2.5 pt **ink** inset + black “Covered pick” + green *dot*.
- Rejected: title/price canvas→`dangerGrey` + strikethrough the **title**. Film strikes the **price** with a 2.5 pt bar and greys the photo; chip “not the item”.
- Approve: `CoveredPrimaryButtonStyle` green. Film: the card *becomes* the 70 pt black pill.

### `Features/Shop/OfferPhoto.swift`

- Default 72 / r10 / `muted.opacity(0.18)`. Film 130 / r14.5 / `#e8e6e1`.

### `Features/Shop/ApproveConfirm.swift`

- Black r22 card, canvas titles, 28 pt canvas price, green “Confirm with Face ID”. Film: **white r33 sheet**, 21 pt wallet, 18.5 title, 25.5 total, grey Face ID hint — no green button (`07-pay-sheet.png`).
- Success: 56 pt **green** check. Film: 117 pt **mint disc**, **black** check (`08-check.png`).
- Short-wallet: still a black card. Film would keep the white sheet.

### `Features/Shop/PairingView.swift`

- Code field: black fill, canvas glyphs, 32 monospaced. Film-like only if you treat it as a sent bubble; better as a `#f0efec` composer. Claim button is green full-width r12.

### `Features/Orders/OrdersView.swift` + `OrderDetailView.swift` + ring

- `navigationTitle("Orders")` large. Film: wordmark + wallet chip (`09-order-row.png`).
- `OrderRow` fill `Color.black`, title 16 semibold canvas, price 16 **accent**, 28 pt green ring. Film: **white** row, 18.5 ink `#CV-id · £price`, 13 `#6f6d67` meta; the ring is a separate hero, not a 28 pt badge.
- Detail card `Color.black`, accent price. Film: `#f3f2ef`, ink type, 91.5 pt thumb, hero black ring (`10` / `11`). Keep “Tracking isn't connected yet” — restyle to 14 / `#6f6d67`.
- Aftercare: user bubble `white.opacity(0.7)`, assistant **black**, send = green capsule, draft card canvas-on-black. Film: user ink / bot `#f0efec`, black send circle, white nested draft, ink Copy pill.
- `ReturnWindowRing` 28×28 stroke 3, green if open. Film hero r58.5 stroke 11 **ink** on `#e2e0da`; compact r20 stroke 4.5 — never green, never strike-grey.

### `Features/Wallet/WalletView.swift` + `LimitRowView.swift` + `LimitsView.swift`

- Balance / deposit sit on `Color.ink` cards, 44 pt **white** money. Film money is **ink on white** at 58.5. Deposit chips may go green-when-selected; the card must not be black.
- History rows `white.opacity(0.55)` on canvas — muddy. Film: white / hairline.
- `LimitRowView` is a full ink card, white type, green status capsules. Film: white card, ink query, `chip.g` / `chip.n`.
- Deposit / New limit / Watch-and-buy are green r12. Film primary = black pill.

### `Features/Settings/SettingsView.swift`

- `insetGrouped` on canvas, rows `white.opacity(0.72)`. Switch the page to white; rows `#fff` with `#ebe9e4` rules.
- Rights use `Stepper`. Film: meter + handle.
- `Button(..., role: .destructive)` → **system red**. Film has no red. Use a quiet ink control.
- `.tint(Color.accent)` turns steppers and the grouped chevron green.

---

## 6. Do-nots

- No dark mode. `preferredColorScheme(.light)` stays.
- No red. Not for reset, not for wallet-short, not for rejected rows. Rejected = grey strike + grey photo.
- No gradients on chrome (nav bars, pills, buttons, rings).
- No glows, no outer shadows on cards, no material blur on the tab bar.
- No system-default blue. Set the view tint to `#0b0b0b`. Accent `#5fd38a` is a *signal*, not `tint`.
- No Apple logos, no Face ID glyph, no Pay mark. Confirm copy is the words “Confirm with Face ID”.
- No green primary buttons. Green fills only: brand/pick dots, in-budget meter, reached tracker nodes, rights-chip background, success disc, “clears £n” chip, selected £ deposit chip.
- No `#ebe8e2` as the screen fill. That is the film’s *desk*, not the phone.
- No SF Symbol tab icons.
- No fake courier tracking.
- Do not put the pound rule in the model prompt; the meter and verdict copy must follow `applyPremium` the way the film’s `shopWins` does.

---

## Crops

| File | Beat (approx t) | What to match |
|---|---|---|
| [01-chat-bubble.png](design-ref/01-chat-bubble.png) | 1.3 / 1.12s | Sent ink bubble, typing dots, composer, Chat pill |
| [02-listing-cards.png](design-ref/02-listing-cards.png) | 2.2 / 2.78s | Four white cards, 130 pt photos, 29 pt prices |
| [03-mislisting-strike.png](design-ref/03-mislisting-strike.png) | 3.2 / 4.82s | Grey photo, struck £349, “not the item” |
| [04-rights-chips-meter.png](design-ref/04-rights-chips-meter.png) | 4.2 / 6.72s | Two-up + green rights chip + gap line |
| [05-premium-slider.png](design-ref/05-premium-slider.png) | 5.1 / 8.18s | Meter, handle, verdict, Covered pick |
| [06-approve-button.png](design-ref/06-approve-button.png) | 6.2 / 10.58s | Summary + rights chip + black Approve pill |
| [07-pay-sheet.png](design-ref/07-pay-sheet.png) | 6.4 / 11.72s | White sheet, 38% dim, Face ID hint slot |
| [08-check.png](design-ref/08-check.png) | 7.4 / 13.62s | Mint disc, black check |
| [09-order-row.png](design-ref/09-order-row.png) | 8.2 / 14.68s | White row, wallet chip, rights chip |
| [10-orders-tracker.png](design-ref/10-orders-tracker.png) | 9.3 / 17.12s | Detail panel + rail (visual only) |
| [11-return-ring.png](design-ref/11-return-ring.png) | 9.4 / 17.78s | Hero black ring, 42 pt “14” |
| [12-price-drop-alert.png](design-ref/12-price-drop-alert.png) | 10.3 / 19.18s | Black alert + memory chips + compact ring |
| [13-sum.png](design-ref/13-sum.png) | 11.3 / 21.22s | Ledger + green save chip |
| [14-memory-chip.png](design-ref/14-memory-chip.png) | 12.3 / 23.28s | £195.00 + Remembered chip |
| [15-tab-bar.png](design-ref/15-tab-bar.png) | 2.1 / 2.22s | Chat pill, photo holes |
| [16-composer.png](design-ref/16-composer.png) | 1.1 / 0.10s | Field + send |
| [17-lightbox.png](design-ref/17-lightbox.png) | 3.1 / 4.18s | Zoomed photo + black caption chip |
| [18-header-wallet.png](design-ref/18-header-wallet.png) | 8.2 / 14.68s | Wordmark + wallet pill |
| [19-orders-tab.png](design-ref/19-orders-tab.png) | 8.3 / 15.18s | Pill slid to Orders |
| [20-chosen-pick.png](design-ref/20-chosen-pick.png) | 5.1 / 8.18s | Covered pick badge (same frame as 05) |

Crops: Playwright `seek(t)` on `covered-film.html`, `#cam` flattened, `#screen` at 2×. `design-ref/shots.json` has the exact times.
