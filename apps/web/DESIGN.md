---
version: alpha
name: Queueless-design-system
description: "A calm, clinical interface language for a public-service queue system. Built on a near-white (light) / near-black (dark) neutral canvas with a single desaturated teal accent used only for primary actions and live-state emphasis. Inspired by the restraint of Linear (single chromatic accent, hairline-bordered surfaces, tight negative-tracked display type) and the quiet precision of Stripe (tabular figures for numbers that matter, generous section rhythm, pill-free but decisive buttons) — without reusing either brand's palette, wordmark, or literal token values. Built dark-first and light-first simultaneously: every color has a light and dark value from day one."

colors:
  light:
    primary: "#1f6f74"
    primary-hover: "#175a5e"
    primary-press: "#124749"
    primary-soft: "#e3f1f1"
    on-primary: "#ffffff"
    canvas: "#ffffff"
    canvas-soft: "#f6f7f9"
    surface: "#ffffff"
    surface-sunken: "#eef0f3"
    ink: "#14171c"
    ink-secondary: "#4a4f5a"
    ink-muted: "#717683"
    hairline: "#e3e6eb"
    hairline-strong: "#cdd2da"
    success: "#197c53"
    success-soft: "#e3f4ea"
    warning: "#9e5f0b"
    warning-soft: "#faf0dd"
    danger: "#c13b34"
    danger-soft: "#fbe8e6"
    focus-ring: "#1f6f74"
  dark:
    primary: "#4fb8ae"
    primary-hover: "#6cc7bd"
    primary-press: "#3d9a91"
    primary-soft: "#123331"
    on-primary: "#04201e"
    canvas: "#0a0c0f"
    canvas-soft: "#101317"
    surface: "#14171c"
    surface-sunken: "#0e1114"
    ink: "#eef0f3"
    ink-secondary: "#b7bcc6"
    ink-muted: "#7d8290"
    hairline: "#24282f"
    hairline-strong: "#343941"
    success: "#4cbf8b"
    success-soft: "#0f2b21"
    warning: "#dba24d"
    warning-soft: "#2e2211"
    danger: "#e5766f"
    danger-soft: "#301715"
    focus-ring: "#4fb8ae"

typography:
  display-lg:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.6px
  display-md:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.4px
  heading-lg:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.2px
  heading-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.1px
  heading-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
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
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  top-nav:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.xs}"
    height: 56px
---

## Overview

Queueless is a public-service queue board first — a hospital OPD counter display, a staff console, a patient-facing status page. It has to read correctly from across a waiting room and stay legible under fluorescent light, so the system leans on **neutral canvas + one accent** rather than the bright primary-color-per-button style of typical hospital software.

`{colors.canvas}` is near-white in light mode (`#ffffff`) and near-black in dark mode (`#0a0c0f`) — never a saturated hospital blue. A two-step surface ladder (`{colors.surface}`, `{colors.surface-sunken}`) separates cards from page background using hairline borders, not shadow, the same way Linear separates panels on its dark canvas.

The single chromatic accent is a desaturated teal (`{colors.primary}` `#1f6f74` light / `#4fb8ae` dark) — calmer than Linear's lavender or Stripe's indigo, chosen so it reads as "system," not "brand." It appears only on primary buttons, focus rings, and the "called" status badge. Status color otherwise stays semantic and sparse: success green for `done`, warning amber for tokens waiting too long, danger red for `no_show` — each with a `-soft` background variant for badges so color never has to shout.

Numbers are the product. Queue and token numbers render in `{typography.token-number}` — a monospace face with tabular figures, the same instinct as Stripe's `tnum` money type, applied here to queue numbers instead of currency so a token board never visually jitters as digits change width.

**Key characteristics:**
- Neutral canvas + one accent (teal), both modes native from day one — never a light-only or dark-only page.
- Two-step surface ladder + hairline borders carry hierarchy; shadows are avoided except a single soft lift on modals.
- Display type at weight 600 with mild negative tracking (-0.6px at 40px down to 0 at body) — restrained, not Linear's -3px extreme.
- Token/queue numbers are monospace + tabular, always the loudest element on a screen.
- Status badges are pill-shaped soft-fill chips; primary actions are `{rounded.md}` 8px rectangles, never pills — a rectangle reads as "action," a pill reads as "state."

## Colors

### Brand & Accent
- **Primary teal** (`{colors.primary}`): primary buttons, focus rings, the "called" status badge, active nav item. Used sparingly — one filled surface per view.
- **Primary Soft** (`{colors.primary-soft}`): tinted background for the "called" badge and selected list rows.

### Surface
- **Canvas** (`{colors.canvas}`): page background.
- **Canvas Soft** (`{colors.canvas-soft}`): app-shell background behind cards (a half-step above canvas).
- **Surface** (`{colors.surface}`): cards, panels, modals, the token tile.
- **Surface Sunken** (`{colors.surface-sunken}`): inset rows, table stripes, the "waiting" badge.
- **Hairline / Hairline Strong**: 1px borders; strong variant for focused inputs and table headers.

### Text
- **Ink**: primary text.
- **Ink Secondary**: labels, table body on light backgrounds.
- **Ink Muted**: timestamps, placeholder text, disabled labels.

### Semantic
- **Success** — `done` tokens, positive stat deltas.
- **Warning** — a token waiting past its service's target time.
- **Danger** — `no_show`, destructive actions, form errors.

Every semantic color ships a `-soft` background pair for badges/banners so status never needs a saturated fill.

## Typography

**Font family:** Inter (variable), loaded via `next/font/google` — free, matches the negative-tracking-on-display feel both reference systems use as their own fallback/substitute. `JetBrains Mono` carries queue numbers only.

| Token | Size | Weight | Line height | Tracking | Use |
|---|---|---|---|---|---|
| `display-lg` | 40px | 600 | 1.15 | -0.6px | Page hero ("Queue for General OPD") |
| `display-md` | 30px | 600 | 1.2 | -0.4px | Section headers, stat tile value |
| `heading-lg` | 22px | 600 | 1.25 | -0.2px | Card title |
| `heading-md` | 18px | 600 | 1.3 | -0.1px | Sub-section title |
| `heading-sm` | 15px | 600 | 1.4 | 0 | List item title |
| `body-lg` | 16px | 400 | 1.55 | 0 | Lead paragraph |
| `body` | 14px | 400 | 1.5 | 0 | Default UI text |
| `body-sm` | 13px | 400 | 1.45 | 0 | Table cells, helper text |
| `caption` | 12px | 500 | 1.35 | 0.1px | Badges, timestamps, eyebrow labels |
| `button` | 14px | 500 | 1.2 | 0 | Button labels |
| `token-number` | 56px | 700 | 1.0 | -0.5px | Queue/token numbers, tabular figures |

Principles: display weight caps at 600 (never 700+, keeps the clinical calm); tracking only ever goes negative on display sizes and only ever slightly positive on `caption` (it is doing label duty); token numbers are the one place the system uses monospace and the one place it goes to weight 700.

## Layout

- **Base unit:** 4px. Tokens: `{spacing.xxs}` 4 · `{spacing.xs}` 8 · `{spacing.sm}` 12 · `{spacing.md}` 16 · `{spacing.lg}` 24 · `{spacing.xl}` 32 · `{spacing.xxl}` 48 · `{spacing.section}` 64.
- Card padding: `{spacing.lg}` 24px. Stat tiles: `{spacing.md}` 16–20px (denser, they tile in a row).
- Content max-width ~960px for staff console screens; the TV/counter-display board is full-bleed and scales token tiles up, not the container.
- Card grids: 3-up desktop → 2-up tablet → 1-up mobile.

## Elevation

Flat by default. Cards lift with `{colors.surface}` fill + 1px `{colors.hairline}` border — no drop shadow. The only shadow in the system is a soft `0 8px 24px rgba(0,0,0,0.12)` under modals/dialogs, kept identical in both themes since it sits over a scrim.

## Shapes

| Token | Value | Use |
|---|---|---|
| `{rounded.xs}` | 4px | Table chrome, small chips |
| `{rounded.sm}` | 6px | Inline tags |
| `{rounded.md}` | 8px | Buttons, inputs — the "action" radius |
| `{rounded.lg}` | 12px | Cards, stat tiles |
| `{rounded.xl}` | 16px | The big token-number tile on the counter/TV display |
| `{rounded.pill}` | 9999px | Status badges only — pill = state, never action |

## Components

- **`button-primary`** — filled teal, white text, `{rounded.md}`. The one filled surface per screen.
- **`button-secondary`** — `{colors.surface}` fill, 1px hairline border, `{colors.ink}` text. Everything that isn't the primary action.
- **`card`** — `{colors.surface}` + hairline border, `{rounded.lg}`, 24px padding. Default container.
- **`stat-tile`** — same card treatment, value rendered in `display-md`, label in `caption` above it. Used on the admin dashboard (queue length, avg. wait, no-show rate).
- **`token-tile`** — the counter/TV display centerpiece: `{rounded.xl}`, big `token-number` type, counter label in `caption` beneath. This is the one component allowed to scale far beyond its base size for a physical display.
- **`status-badge-*`** — pill, soft-fill background, semantic text color, `caption` type. One per token status: `waiting` (neutral), `called` (primary-soft), `done` (success-soft), `no_show` (danger-soft, also reused for `serving`→primary and any future terminal state).
- **`text-input`** — `{colors.canvas}` fill (sits inside cards, so it needs to read as a cutout), hairline border, `{rounded.md}`. Focus state swaps border to `{colors.primary}` + a 2px `{colors.focus-ring}` outline at 40% opacity.
- **`top-nav`** — 56px, `{colors.surface}` fill, hairline bottom border, service switcher left, role/staff identity right.

## Do's and Don'ts

### Do
- Keep exactly one filled accent surface per screen (the primary button).
- Render every queue/token number in `token-number` with tabular figures.
- Ship both themes for every component before calling it done — this is a live demo on a projector, dark mode is not optional polish.
- Use pill radius only for status; use `{rounded.md}` rectangles for anything clickable.

### Don't
- Don't add a second chromatic accent — status colors are semantic, not decorative.
- Don't use drop shadows for card hierarchy — hairline borders + the surface ladder do that job.
- Don't set display type above weight 600 or push tracking past -0.6px — this isn't a marketing page, it needs to stay calm under a hospital's fluorescent lights.

## Responsive Behavior

| Breakpoint | Width | Key change |
|---|---|---|
| Desktop | ≥1024px | Staff console: sidebar + content. TV board: token tiles at full scale. |
| Tablet | 768–1023px | Sidebar collapses to icons; stat tiles 3-up → 2-up. |
| Mobile | <768px | Patient status page only (staff console is not optimized for phone); single column, token tile stays large and centered. |

Touch targets ≥44px on any control a counter/staff user taps repeatedly (call next, mark done) — this is used standing at a counter, not sitting at a desk.

`/display/[service]` is the one screen meant to run at *any* size in that range at once, from a kiosk-adjacent laptop up to a wall-mounted TV, so every size on it (title, stat values, counter tiles, the "next up" list, and `token-number-board` above) is a `clamp(min, preferred-vw, max)` scaled to viewport width rather than a fixed ramp step — deliberate fluid type, not drift off the ramp.
