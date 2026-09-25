---
version: beta
name: Queueless-design-system
description: "A bright, clinical public-service look after the MedWin hospital template: white base, one cyan accent, dark slate-teal sections, near-black ink, Poppins display type set bold and uppercase with a cyan second word. Public screens (landing, kiosk, token status, login) carry the full marketing treatment: numbered cards, overlapping hero card, rounded dark section, cyan-dot footer. Staff screens (counter, admin) take the same palette, radii and type pairing but stay dense and fast. Light is the default theme; dark is an explicit toggle. Every text colour pair is AA-checked by apps/web/brand/contrast-check.mjs."

colors:
  brand:
    accent: "#0cb7d6"
    accent-hover: "#2cc1db"
    on-accent: "#252525"
    slate: "#1a3237"
    slate-deep: "#112427"
    slate-overlay: "rgba(26, 50, 55, 0.84)"
    on-slate: "#ffffff"
    on-slate-muted: "#b3c6ca"
  light:
    primary: "#087589"
    primary-hover: "#066474"
    primary-press: "#055563"
    primary-soft: "#e3f5f8"
    on-primary: "#ffffff"
    accent-display: "#0a95ae"
    canvas: "#ffffff"
    canvas-soft: "#f5f8f9"
    surface: "#ffffff"
    surface-sunken: "#eef3f4"
    ink: "#252525"
    ink-secondary: "#4a4a4a"
    ink-muted: "#6b6b6b"
    hairline: "#e4e7e8"
    hairline-strong: "#cfcfcf"
    success: "#197c53"
    success-soft: "#e3f4ea"
    warning: "#95590a"
    warning-soft: "#faf0dd"
    danger: "#c13b34"
    danger-soft: "#fbe8e6"
    focus-ring: "#087589"
  dark:
    primary: "#2cc1db"
    primary-hover: "#56cfe4"
    primary-press: "#0cb7d6"
    primary-soft: "#0e3339"
    on-primary: "#0b1517"
    accent-display: "#0cb7d6"
    canvas: "#0b1517"
    canvas-soft: "#0f1c1f"
    surface: "#132428"
    surface-sunken: "#0a1214"
    ink: "#eef3f4"
    ink-secondary: "#b8c6c9"
    ink-muted: "#8fa3a7"
    hairline: "#203539"
    hairline-strong: "#2e474c"
    success: "#4cbf8b"
    success-soft: "#0f2b21"
    warning: "#dba24d"
    warning-soft: "#2e2211"
    danger: "#e5766f"
    danger-soft: "#301715"
    focus-ring: "#2cc1db"

shadows:
  light:
    card: "0 1px 2px rgba(26, 50, 55, 0.06), 0 10px 28px -12px rgba(26, 50, 55, 0.22)"
    raised: "0 22px 48px -18px rgba(26, 50, 55, 0.4)"
  dark:
    card: "0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 28px -12px rgba(0, 0, 0, 0.6)"
    raised: "0 22px 48px -18px rgba(0, 0, 0, 0.75)"

fonts:
  display: "Poppins (400, 700) via next/font, --font-poppins"
  body: "Inter (variable) via next/font, --font-inter"
  mono: "JetBrains Mono via next/font, --font-jetbrains-mono"

typography:
  display-hero:
    fontFamily: Poppins
    fontSize: "clamp(32px, 5vw, 56px)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: 0.01em
    textTransform: uppercase
    note: "Landing hero only ('TAKE A TOKEN. LEAVE THE LINE.'), white on the slate overlay."
  display-lg:
    fontFamily: Poppins
    fontSize: "clamp(28px, 4vw, 40px)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: 0.02em
    textTransform: uppercase
    note: "Two-tone section headings (TwoToneHeading). MedWin's 40px section title."
  display-md:
    fontFamily: Poppins
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0
    note: "Staff page titles and stat-tile values, sentence case."
  numeral-card:
    fontFamily: Poppins
    fontSize: "clamp(44px, 6vw, 60px)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: 0
    fontFeature: tnum
    note: "The 01 02 03 04 on numbered cards."
  heading-lg:
    fontFamily: Poppins
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0
  heading-md:
    fontFamily: Poppins
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0
  footer-heading:
    fontFamily: Poppins
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: 0.06em
    textTransform: uppercase
  heading-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  body-lg:
    fontFamily: "Poppins on public screens, Inter on staff screens"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0.1px
  button:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0
    note: "Staff screens."
  button-cta:
    fontFamily: Poppins
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0.06em
    textTransform: uppercase
    note: "Public screens, MedWin's READ MORE / BOOK buttons."
  token-number:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 56px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.5px
    fontFeature: tnum
  token-number-kiosk:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 96px
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.5px
    fontFeature: tnum
    note: "The just-issued number on /kiosk, read at arm's length by the staff member handing over the slip -- one deliberate step above token-number, not a stray value."
  token-number-board:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "clamp(64px, 10vw, 180px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: -0.5px
    fontFeature: tnum
    note: "/display/[service]'s now-serving tiles -- fluid by design so a phone-sized preview and a wall-mounted TV both stay legible from their own real viewing distance; every other clamp() endpoint on that page (title, stat values, next-up chips) scales off this same instinct."
  caption-xs:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: 0
    note: "The fallback status URL printed under a token slip's QR code -- only read when the QR itself fails to scan."

rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  section: "clamp(32px, 8vw, 120px)"
  pill: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-accent:
    backgroundColor: "{colors.brand.accent}"
    textColor: "{colors.brand.on-accent}"
    typography: "{typography.button-cta}"
    rounded: "{rounded.sm}"
    padding: 12px 28px
    hover: "{colors.brand.accent-hover}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.button-cta}"
    rounded: "{rounded.sm}"
    padding: 12px 28px
    hover: "border {colors.brand.accent}, text {colors.primary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 24px
  card-public:
    backgroundColor: "{colors.surface}"
    shadow: "{shadows.card}"
    rounded: "{rounded.lg}"
    padding: 32px
  card-overlap:
    backgroundColor: "{colors.surface}"
    shadow: "{shadows.raised}"
    rounded: "{rounded.lg}"
    padding: 40px
    note: "Pulled up over the hero with a negative margin, MedWin's appointment box."
  section-dark:
    backgroundColor: "{colors.brand.slate}"
    textColor: "{colors.brand.on-slate}"
    rounded: "{rounded.section}"
    padding: "{spacing.section} {spacing.lg}"
  stat-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.display-md}"
    rounded: "{rounded.lg}"
    padding: 20px
  status-badge-waiting:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 10px
  status-badge-called:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 10px
  status-badge-done:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 10px
  status-badge-no-show:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 2px 10px
  token-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.token-number}"
    rounded: "{rounded.xl}"
    padding: 24px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.hairline-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: 10px 14px
  top-nav:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    height: 64px
---

## Overview

Queueless is a public-service queue platform; the demo preset is a hospital OPD. The look follows the MedWin hospital template: a bright white base, one cyan accent (`#0cb7d6`), dark slate-teal sections (`#1a3237`), near-black ink (`#252525`) and Poppins set bold and uppercase for headings, with the second word of a heading in cyan ("TAKE A **TOKEN**").

There are two registers:

- **Public screens** (`/`, `/kiosk`, `/t/[id]`, `/login`): the full treatment. Two-tone uppercase headings, "01 02 03 04" numbered cards, a hero with a slate overlay and an overlapping white card, a dark section with big rounded corners, soft card shadows, and the cyan-dot footer. Shared chrome lives in `src/components/site/` (`PublicHeader`, `PublicFooter`, `TwoToneHeading`).
- **Staff screens** (`/counter`, `/admin/**`): same palette, radii and display face, but dense. Hairline-bordered cards, Inter body text, sentence-case Poppins titles, no numbered cards or two-tone headings.

`/display/[service]` (the TV board) is fixed to the slate-teal treatment and ignores the theme toggle.

The brand mark (`src/components/brand/Logo.tsx`, see `brand/BRAND.md`) is the same in every header.

## Theme

Light is the default. The theme is attribute-driven, not `prefers-color-scheme`:

- `:root` holds the light values and every theme-independent token.
- `:root[data-theme="dark"]` overrides the colour and shadow tokens.
- A tiny inline script in `layout.tsx`'s `<head>` reads `localStorage["queueless-theme"]` and sets `data-theme` before first paint. A first-time visitor with nothing stored gets **light**, whatever their OS prefers.
- `ThemeToggle` (`src/components/theme/ThemeToggle.tsx`) flips the attribute and stores the choice.
- In a CSS Module, scope a dark-only rule as `:global(:root[data-theme="dark"]) .thing { ... }`. Do not use `@media (prefers-color-scheme)`.

## Colors

### Brand constants (both themes)
- **Accent** `#0cb7d6`: button fills (with ink text), cyan dots, icons, the logo slip, and any cyan text on slate. It is **2.40:1 on white, which fails AA even for large text**, so it is never text on a light background.
- **Accent Hover** `#2cc1db`: hover fill for accent buttons.
- **On Accent** `#252525`: text on accent fills (6.39:1). White on cyan is 2.40:1; never use it.
- **Slate** `#1a3237`: dark sections, the TV board, the icon tile. **Slate Deep** `#112427`: footer.
- **Slate Overlay** `rgba(26,50,55,0.84)`: over hero photos. White text stays at 8.12:1 or better even over a pure-white pixel; cyan on the overlay falls to 3.39:1 there, so cyan on a photo is large text only.
- **On Slate** `#ffffff` and **On Slate Muted** `#b3c6ca` for text on slate and slate-deep.

### Theme colours
- **Primary** (`#087589` light / `#2cc1db` dark): the AA-safe cyan. Links, small cyan text, filled buttons with white text, focus rings, the "called" badge. It clears 4.5:1 on white, canvas-soft and its own soft tint.
- **Accent Display** (`#0a95ae` light / `#0cb7d6` dark): the cyan words in headings on light surfaces. Large text only (24px+, or bold 19px+): 3.55:1 on white. Inside a slate section use the brand accent instead (`TwoToneHeading onDark`).
- **Ink** `#252525`, **Ink Secondary** `#4a4a4a`, **Ink Muted** `#6b6b6b`. MedWin's muted `#898989` is 3.50:1 on white and fails for body text, so it is not a token.
- **Canvas / Canvas Soft / Surface / Surface Sunken**: page, app-shell behind cards, cards, inset rows.
- **Hairline** `#e4e7e8` (card borders) and **Hairline Strong** `#cfcfcf` (MedWin's input border, table headers).
- **Success / Warning / Danger**, each with a `-soft` badge background. These are now global, so route modules no longer need local copies.

## Typography

**Font split (decision):**
- **Poppins** (400/700, `--font-display`) is the display face sitewide: every heading, the wordmark, the numbered-card numerals and the public CTA buttons.
- **Inter** (`--font-body`) is the body/UI face and the `body` default. Staff screens (`/counter`, `/admin/**`) keep it for compact, fast reading at 13–14px.
- **Public screens** (`/`, `/kiosk`, `/t/[id]`, `/login`) set `font-family: var(--font-display)` on their root, so their body copy is Poppins 400 too. They are low-density with body text at 15–16px, where Poppins reads cleanly, and this matches MedWin's Poppins-only page.
- **JetBrains Mono** (`--font-mono`) sets token numbers everywhere (tabular figures).

| Token | Face | Size | Weight | Case | Use |
|---|---|---|---|---|---|
| `display-hero` | Poppins | 32–56px fluid | 700 | UPPER | Landing hero |
| `display-lg` | Poppins | 28–40px fluid | 700 | UPPER, +0.02em | Two-tone section headings |
| `display-md` | Poppins | 30px | 700 | Sentence | Staff page titles, stat values |
| `numeral-card` | Poppins | 44–60px fluid | 400 | - | 01 02 03 04 |
| `heading-lg` | Poppins | 22px | 700 | Sentence | Card titles |
| `heading-md` | Poppins | 18px | 700 | Sentence | Sub-sections |
| `footer-heading` | Poppins | 16px | 700 | UPPER, +0.06em | Cyan-dot footer headings |
| `heading-sm` | Inter | 15px | 600 | Sentence | Staff list-item titles |
| `body-lg` | Poppins / Inter | 16px | 400 | - | Lead copy |
| `body` | Inter | 14px | 400 | - | Default UI text |
| `body-sm` | Inter | 13px | 400 | - | Table cells, helper text |
| `caption` | Inter | 12px | 500 | - | Badges, timestamps |
| `button` | Inter | 14px | 500 | - | Staff buttons |
| `button-cta` | Poppins | 14px | 700 | UPPER, +0.06em | Public CTAs |
| `token-number*` | JetBrains Mono | 56 / 96 / fluid | 700 | - | Queue numbers |

## Layout

- **Base unit:** 4px. Spacing tokens run `xxs` 4, `xs` 8, `sm` 12, `md` 16, `lg` 24, `xl` 32, `xxl` 48, `section` 64.
- **Public content** max-width is 1140px, with a 16px side gutter on mobile. **Staff console** content stays around 960px.
- **Card grids:** 4-up for numbered cards on desktop, 2-up on tablet, 1-up on mobile. Other grids are 3 → 2 → 1.

## Elevation

- **Public screens** use MedWin's soft shadows: `--shadow-card` on cards and `--shadow-raised` on the overlapping hero card and dialogs.
- **Staff screens** stay flat, with `surface` fill and a 1px `hairline` border, because density matters more there than lift.

## Shapes

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 4px | Table chrome, small chips |
| `--radius-sm` | 6px | Public CTA buttons, inputs (MedWin's 5px) |
| `--radius-md` | 8px | Staff buttons |
| `--radius-lg` | 12px | Cards, stat tiles |
| `--radius-xl` | 16px | The token tile |
| `--radius-section` | 32–120px fluid | Dark slate section corners |
| `--radius-pill` | 9999px | Status badges only |

## Components

- **`button-accent`**: cyan fill, **ink** text, uppercase Poppins. The MedWin solid button. It hovers to `accent-hover`.
- **`button-outline`**: transparent with a `hairline-strong` border and ink text. On hover the border turns accent and the text turns primary. The MedWin READ MORE button.
- **`button-primary`**: `primary` fill with white text. The staff-screen action button.
- **`card-public`**: surface, `shadow-card`, `radius-lg`.
- **`card-overlap`**: the same with `shadow-raised`, pulled up over the hero.
- **`section-dark`**: slate fill, white text, `radius-section` corners.
- **`TwoToneHeading`** (`src/components/site/TwoToneHeading.tsx`): `display-lg` with the lead words in ink and the accent words in `accent-display`, or brand accent with `onDark`.
- **`PublicHeader`** (`src/components/site/`): skip link, logo, public nav (Home, Get a token, Check status, Staff login as an outline button) and the theme toggle. `tone="slate"` sits it transparent on the hero overlay with white text. Pages that use it render `<main id="main">` (skip-link target), and the landing page's status lookup carries `id="status"` ("Check status" links to `/#status`).
- **`PublicFooter`** (`src/components/site/`): slate-deep in both themes, logo and tagline, cyan-dot column headings, and a `credit` slot for photo credits.
- **`ThemeToggle`** (`src/components/theme/ThemeToggle.tsx`): a 44px round icon button in every header. `aria-label` names the target theme ("Switch to dark theme").
- **Status badges, token tile, stat tile, text input**: unchanged in shape. Inputs take `radius-sm` and the `hairline-strong` border.

## Do's and Don'ts

### Do
- Put cyan **text** on light backgrounds in `primary` (small) or `accent-display` (large). Put `accent` only on fills, dots, icons and slate backgrounds.
- Put ink text on accent fills.
- Render every queue/token number in `token-number` with tabular figures.
- Ship both themes for every component, except the TV board, which is fixed.
- Re-run `node brand/contrast-check.mjs` after changing any colour token.

### Don't
- Don't put white text on `#0cb7d6`. It is 2.40:1.
- Don't use `#898989` for text.
- Don't use `@media (prefers-color-scheme)`. Theme is `data-theme` only.
- Don't bring the numbered cards or two-tone headings into the counter console or admin tables.
- Don't add a second chromatic accent. Status colours are semantic, not decorative.

## Responsive Behavior

| Breakpoint | Width | Key change |
|---|---|---|
| Desktop | ≥1024px | Staff console: sidebar + content. Public: 4-up numbered cards, hero card overlaps. |
| Tablet | 768–1023px | Admin sidebar collapses to icons; grids go 2-up. |
| Mobile | <768px | Public header nav drops to its own full-width row under the logo (no menu button, so "Get a token" is one tap); single column; 16px side gutter; no horizontal scroll. |

Touch targets are at least 44px on any control a counter/staff user taps repeatedly (call next, mark done), and on public nav and CTAs.

`/display/[service]` is the one screen meant to run at *any* size in that range at once, from a kiosk-adjacent laptop up to a wall-mounted TV. So every size on it (title, stat values, counter tiles, the "next up" list, and `token-number-board` above) is a `clamp(min, preferred-vw, max)` scaled to viewport width rather than a fixed ramp step. This is deliberate fluid type, not drift off the ramp.
