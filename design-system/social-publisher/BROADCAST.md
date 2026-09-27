# "Broadcast" visual identity (2026-09-27)

Supersedes the colour, type and motion sections of `MASTER.md`. Source: UI/UX Pro Max
(`--design-system "creator social media video publishing app vibrant premium dark" --variance 7 --motion 8`,
style "Vibrant & Block-based", fonts Space Grotesk + Inter), adapted by hand.

**Concept:** one signal fans out to three platforms. The logo is a play-shaped core with three
arcs radiating from it. The brand gradient runs violet → magenta → orange (a nod to the
creator world without copying any platform's brand).

## Colour

**Dark-first "Aurora Night" (user decisions, 2026-09-27):** no white theme; colours must be
attractive *and* eye-soothing. The app always uses this dark palette:
- Surfaces are midnight blue: surface/ink `#0B1020`, cards `#121833`, containers `#182042` / `#212A52`,
  outlineVariant `#2A3462`.
- Soft white text: onSurface `#E8ECF8`, onSurfaceVariant `#A9B2D3`.
- Primary periwinkle `#A5B4FC`, accent aqua `#5EEAD4`.
- Brand gradient (analogous, calm): indigo `#6366F1` → violet `#8B5CF6` → soft rose `#F0A6CA`,
  plus a warm spark `#FDBA74` for the logo dot.
- Buttons use a calm indigo → violet two-tone, not the full gradient.

Everything below this note (the table and gradient hexes) is the superseded "Broadcast" v1 palette,
kept for reference. `tokens.ts` is the source of truth.

Brand gradient (always in this order, 135° / top-left → bottom-right):
`#7C3AED` (violet) → `#DB2777` (magenta) → `#F97316` (orange).
Text on the gradient is always white, weight ≥ 600 (white on #DB2777 = 4.6:1).

| Role | Light | Dark |
|---|---|---|
| primary | `#6D28D9` | `#C4B5FD` |
| onPrimary | `#FFFFFF` | `#2E1065` |
| primaryContainer | `#EDE9FE` | `#3B1F7A` |
| onPrimaryContainer | `#2E1065` | `#EDE9FE` |
| secondaryContainer | `#FCE7F3` | `#3A1530` |
| onSecondaryContainer | `#831843` | `#FBCFE8` |
| accent | `#DB2777` | `#F472B6` |
| onAccent | `#FFFFFF` | `#3A0A24` |
| surface (page background) | `#F7F5FC` | `#0B0A12` |
| surfaceContainerLow (cards) | `#FFFFFF` | `#14121E` |
| surfaceContainer | `#EFECF8` | `#1B1828` |
| surfaceContainerHigh | `#E6E1F3` | `#252136` |
| onSurface | `#15121F` | `#ECE9F5` |
| onSurfaceVariant | `#565170` | `#ABA5C0` |
| outline | `#7A7493` | `#8A84A0` |
| outlineVariant | `#E0DBEE` | `#2C283D` |
| error / onError / errorContainer / onErrorContainer | `#B3261E` `#FFFFFF` `#F9DEDC` `#410E0B` | `#F2B8B5` `#601410` `#8C1D18` `#F9DEDC` |
| success / successContainer / onSuccessContainer | `#15803D` `#DCFCE7` `#14532D` | `#86EFAC` `#12351F` `#DCFCE7` |
| warning / warningContainer / onWarningContainer | `#B45309` `#FEF3C7` `#78350F` | `#FCD34D` `#3D2A0A` `#FEF3C7` |
| scrim | `rgba(11,10,18,0.5)` | `rgba(0,0,0,0.65)` |

Ambient glow (screen backgrounds, hero cards): radial blobs of violet `#7C3AED` and magenta
`#DB2777` at 10–18 % opacity (dark) / 8–12 % (light). Never behind body text at >20 %.

## Type

- Display and headings: **Space Grotesk** 700/600 (`SpaceGrotesk_700Bold`, `SpaceGrotesk_600SemiBold`).
- Body and labels: **Inter** 400/500/600 (`Inter_400Regular`, `Inter_500Medium`, `Inter_600SemiBold`).
- On Android set `fontFamily` per weight and do not also set `fontWeight` (avoids faux bold).

| Role | Font | Size / line |
|---|---|---|
| displaySmall | SG 700 | 36 / 42, letterSpacing -0.5 |
| headlineMedium | SG 700 | 28 / 34, -0.3 |
| headlineSmall | SG 600 | 24 / 30 |
| titleLarge | SG 600 | 20 / 26 |
| titleMedium | Inter 600 | 16 / 24 |
| titleSmall | Inter 600 | 14 / 20 |
| bodyLarge | Inter 400 | 16 / 24 |
| bodyMedium | Inter 400 | 14 / 20 |
| bodySmall | Inter 400 | 12 / 16 |
| labelLarge | Inter 600 | 14 / 20, +0.1 |
| labelMedium | Inter 600 | 12 / 16, +0.4 |
| stat (numbers) | SG 700 | 32 / 38, tabular |

## Shape and elevation

Radius: xs 6, sm 10, md 14, lg 20, xl 28, full. Cards use lg (20). Buttons are full pills.
Elevation: light mode uses soft violet-tinted shadows (`shadowColor #2E1065`, opacity 0.08,
radius 16, elevation 3). Dark mode uses no shadow; cards get a 1 px `outlineVariant` border instead.

## Motion (Reanimated 4, UI thread)

- Tokens: fast 150, standard 250, emphasized 450; spring `{ damping: 16, stiffness: 180, mass: 1 }`.
- Press: scale to 0.97 with spring, plus `Haptics.selectionAsync()` on primary actions.
- List entrance: `FadeInDown` 12 px, stagger 40 ms per item, cap at 8 items.
- Number count-up on analytics stat cards (600 ms, ease-out).
- Skeleton shimmer for loading lists (>300 ms).
- Always honour `useReducedMotion()`: skip entrances, loops and count-ups and show the final state.
- At most 1–2 animated elements per view; only loaders loop.

## Brand mark and loader

`BrandMark`: SVG in a 120×120 viewBox. It has three parts:
- a rounded triangle "play" core filled with the gradient;
- three concentric arcs to the right of the core (≈ -50° to +50°), stroke 6, round caps, gradient stroke, radii 30 / 42 / 54 from the core centre;
- a small orange dot orbiting on the outer arc.

`AnimatedSplash` sequence (about 1.8 s, then waits for the app to be ready):
1. Core scales from 0.4 with a spring and fades in (0–450 ms).
2. The arcs draw in one after another with `strokeDashoffset` (inner → outer, 120 ms stagger).
3. A glow ring pulses outward behind the mark; the wordmark "Social Publisher" fades up 8 px.
4. Loop while waiting: the arcs "broadcast" (opacity wave inner → outer, 1.2 s period).
5. Exit when ready: the mark scales to 1.15 and the overlay fades out (350 ms), revealing the app.

`BrandLoader`: the mark at 56 px with the broadcast loop, used for full-screen and section loading.
