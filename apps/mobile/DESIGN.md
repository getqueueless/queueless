# Queueless mobile — MedWin-derived design tokens

Derived directly from `~/code/design-ref/medwin/` (a static HTML template) and
`~/code/design-ref/medwin-full.png`, not from `apps/web/DESIGN.md` — that file still describes
the old teal/Inter "calm clinical" system as of 2026-09-25 and the web session's own MedWin pass
hadn't landed there when this was written. Every color below cites the `css/style.css` line it
came from, the same discipline this repo's `docs/DECISIONS.md` already uses for migrations. If
`apps/web/DESIGN.md` lands a MedWin token set before this one is reconciled, that file is the
documented source of truth for the pair — see `docs/DECISIONS.md` for the reconciliation note.

## Colors

### Light

| Token | Hex | Source |
|---|---|---|
| `primary` | `#0cb7d6` | style.css:219 (also 740, 744; a couple of call sites use `#0cb6d5` — same intended color, standardized here) |
| `primaryOutline` | `#2cc1db` | style.css:740, 745 — lighter cyan, borders/hover/active states, never a fill |
| `dark` (hero/footer band) | `#1a3237` | style.css:757 |
| `ink` | `#1f1f1f` | standardized from `#1f1f1f`/`#111111`/`#212121`, all used for headings/dark text — `#1f1f1f` is the most common |
| `inkSecondary` | `#898989` | style.css:517, 532, 605 — standardized from `#898989`/`#767676`/`#6d6d6d` |
| `inkMuted` | `#666666` | style.css:31 (body copy default color) |
| `hairline` | `#cfcfcf` | style.css:508, 529, 553, 1011, 1028 |
| `canvas` | `#ffffff` | template's page background throughout |
| `canvasSoft` | `#f7fbfc` | derived: a faint tint of `primary` for section backgrounds, not a literal template value |
| `surface` | `#ffffff` | cards sit on white with a hairline border + soft shadow (style.css:480, 899), never a filled card background |
| `primaryDisplay` | `#0a95ae` | apps/web/brand/BRAND.md "Cyan display": large cyan words on white only (3.55:1). `primary` itself is 2.40:1 on white, so it is never text |
| `onPrimary` | `#252525` | text on `primary` fills: ink, 6.39:1. Not MedWin's white, which is 2.40:1 on `#0cb7d6` and fails AA at every size (BRAND.md) |

`primarySoft` (light tint of `primary`) and `surfaceSunken` are kept as compatibility tokens so
pre-existing usages (banners, badges) keep compiling while the shared module lands ahead of
per-screen restyling — not literal MedWin values, just a derived tint.

`danger`/`warning`/`success` are **not** MedWin colors — the template has none, and its two
decorative one-offs (`#fb6818` orange, style.css:297; `#e52e71` pink, style.css:584) are not
promoted into the token set as semantic roles, per the task brief. Kept the existing project
values instead (danger `#c23b34`, warning `#a9660c`, success `#1c8a5c`, each with a `-soft`
tint), unchanged from the pre-redesign `theme.ts`.

### Dark (MedWin itself is light-only; derived in its own spirit — darken canvas, brighten accent)

| Token | Hex |
|---|---|
| `primary` | `#3fd6f0` |
| `primaryOutline` | `#5fdcf3` |
| `dark` | `#0d1a1d` |
| `ink` | `#eef0f3` |
| `inkSecondary` | `#a9adb3` |
| `inkMuted` | `#7d8290` |
| `hairline` | `#2a2f36` |
| `canvas` | `#0a0c0f` |
| `canvasSoft` | `#0e1518` |
| `surface` | `#14171c` |
| `primaryDisplay` | `#3fd6f0` |
| `onPrimary` | `#04201e` |
| `danger` | `#e5766f`, `dangerSoft` `#301715` |
| `warning` | `#dba24d`, `warningSoft` `#2e2211` |
| `success` | `#4cbf8b`, `successSoft` `#0f2b21` |

## Typography

Poppins, weights 400/700 only (index.html:29 — `@expo-google-fonts/poppins`,
`Poppins_400Regular` + `Poppins_700Bold`; SIL Open Font License, free). Headings render
**uppercase** with the 700 weight (style.css uses `text-transform: uppercase` on the large majority
of its section/card titles — lines 318, 369, 425, 453, 489, 654, 735, 771, 885, 990, 1048, 1094,
1141); body copy stays regular weight, sentence case, 400.

`tokenNumber` is the one exception — kept as the existing tabular monospace treatment, not
Poppins. Large legible digits and the digit-alignment work already done matter more than brand
consistency there.

| `ThemedText` type | Family | Weight | Transform | Notes |
|---|---|---|---|---|
| `displayLg` | Poppins | 700 | uppercase | page-level headings |
| `displayMd` | Poppins | 700 | uppercase | section headings |
| `headingLg` | Poppins | 700 | uppercase | card/screen titles |
| `headingMd` | Poppins | 700 | uppercase | sub-section titles |
| `headingSm` | Poppins | 700 | none | list item titles — template's `h3`/`h4` card titles are not all-caps |
| `bodyLg` | Poppins | 400 | none | lead paragraph |
| `body` | Poppins | 400 | none | default UI text |
| `bodySm` | Poppins | 400 | none | helper text, template's `.treatment_text` style |
| `caption` | Poppins | 400 | none | badges, timestamps |
| `button` | Poppins | 700 | uppercase | style.css:735 `.readmore_bt` and most CTA buttons are uppercase |
| `tokenNumber` | monospace (unchanged) | 700 | none | queue/token numbers only |

## Components

- **`TwoToneHeading`** (`src/components/TwoToneHeading.tsx`) — takes the full heading string plus
  which word(s) render in `primaryDisplay`, e.g. `<TwoToneHeading text="OUR MEDICAL SERVICES" accent="SERVICES" />`.
  Mirrors index.html:127's `Book <span style="color:#0cb7d6">Appointment</span>` pattern, reused
  as a component instead of hand-splitting `<Text>` runs on every screen.
- **Numbered card** — a large faint `primaryDisplay`-tinted number (`01`–`04` style, style.css's
  `.number_text`/`.care_text` pattern from index.html:221-241), a heading, a short line. Used for
  Home's service list — the pattern, not the literal MedWin icon set.
- **Card** — white `surface`, `hairline` border, soft shadow (`0 0 10px rgba(0,0,0,0.08)`-ish,
  derived from style.css:480/899's blurred/no-offset shadows), generous padding — MedWin leans on
  soft shadows and generous card padding, a step softer/roomier than this app's pre-redesign flat
  hairline-only cards.
- **Button (primary)** — filled `primary`, `onPrimary` text, uppercase `button` type, rounded
  corners (style.css:586 uses 8px on `.book_btn a`). **Never** `primary` as a text color at body
  size — `#0cb7d6` on white is ~2.4:1 contrast, well under WCAG AA's 4.5:1 text minimum. Use
  `primaryOutline` (or a further-darkened value) for any small cyan-colored text; `primary` itself
  is fill/large-graphic/button-background only.
- **Button (outline)** — transparent fill, `primaryOutline` border, per style.css:739-745's
  hover/active state on `.readmore_bt`.

Spacing/radius scales are unchanged from the pre-redesign `theme.ts` (`Spacing`, `Rounded`) — the
template's proportions don't call for new tokens, just softer shadows and roomier card padding
using the scales that already exist.

## Dark-mode preference

`useTheme()` resolves a `"system" | "light" | "dark"` preference (default `"system"`) stored under
key `queueless-theme-preference` in the same `localStorage` global `expo-sqlite/localStorage/install`
already polyfills for the Supabase client — no new persistence dependency. `"system"` resolves via
`useColorScheme()` exactly as before.
