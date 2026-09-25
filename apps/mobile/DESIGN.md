# Queueless mobile — MedWin-derived design tokens

Derived directly from `~/code/design-ref/medwin/` (a static HTML template) and
`~/code/design-ref/medwin-full.png`. Every color below cites the `css/style.css` line it came
from, the same discipline this repo's `docs/DECISIONS.md` already uses for migrations.

apps/web's MedWin token layer (`apps/web/src/app/globals.css`, c94d4c2) has since landed with
AA-checked values, and it is the source of truth for text colors; mobile's text tokens now use its
values. The names differ, though:

| Web | Mobile |
|---|---|
| `--color-accent` `#0cb7d6` | `primary` (fill only) |
| `--color-accent-display` `#0a95ae` | `primaryDisplay` |
| `--color-primary` `#087589` | `primaryText` |
| `--color-on-accent` `#252525` | `onPrimary` |

One deliberate difference: web's filled buttons are `#087589` with white text, while mobile's keep
the bright `#0cb7d6` fill with ink text. Both pass AA.

## Colors

### Light

| Token | Hex | Source |
|---|---|---|
| `primary` | `#0cb7d6` | style.css:219 (also 740, 744; a couple of call sites use `#0cb6d5` — same intended color, standardized here) |
| `primaryOutline` | `#2cc1db` | style.css:740, 745 — lighter cyan, borders/hover/active states, never a fill |
| `dark` (hero/footer band) | `#1a3237` | style.css:757 |
| `ink` | `#252525` | BRAND.md Ink (15.3:1 on white), the same value as `onPrimary`. MedWin's `#1f1f1f` was close. |
| `inkSecondary` | `#6b6b6b` | web's `--color-ink-muted` (5.33:1 on white). MedWin's `#898989` (style.css:517) is 3.50:1 and fails AA for body text |
| `inkMuted` | `#666666` | style.css:31 (body copy default color) |
| `hairline` | `#cfcfcf` | style.css:508, 529, 553, 1011, 1028 |
| `canvas` | `#ffffff` | template's page background throughout |
| `canvasSoft` | `#f7fbfc` | derived: a faint tint of `primary` for section backgrounds, not a literal template value |
| `surface` | `#ffffff` | cards sit on white with a hairline border + soft shadow (style.css:480, 899), never a filled card background |
| `primaryDisplay` | `#0a95ae` | apps/web/brand/BRAND.md "Cyan display": large cyan words on white only (3.55:1). `primary` itself is 2.40:1 on white, so it is never text |
| `primaryText` | `#087589` | BRAND.md "Cyan text": small cyan text, links and the selected tab label (5.36:1 on white, 4.84:1 on `primarySoft`) |
| `onPrimary` | `#252525` | text on `primary` fills: ink, 6.39:1. Not MedWin's white, which is 2.40:1 on `#0cb7d6` and fails AA at every size (BRAND.md) |

`primarySoft` (light tint of `primary`) and `surfaceSunken` are kept as compatibility tokens so
pre-existing usages (banners, badges) keep compiling while the shared module lands ahead of
per-screen restyling — not literal MedWin values, just a derived tint.

`danger`/`warning`/`success` are **not** MedWin colors — the template has none, and its two
decorative one-offs (`#fb6818` orange, style.css:297; `#e52e71` pink, style.css:584) are not
promoted into the token set as semantic roles, per the task brief. Their text values now follow
web's AA-checked set (danger `#c13b34`, warning `#95590a`, success `#197c53`), so each passes
4.5:1 on its own `-soft` tint.

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
| `primaryText` | `#5fdcf3` |
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
- **`AnimatedHeading`** (`src/components/AnimatedHeading.tsx`) — the same two-tone heading (second
  word cyan unless `accent` names others), with each letter fading in, rising and scaling
  0.96 → 1 on a 30 ms stagger, once on mount. `size="display"` (26–34, scales with window width,
  `ink` + `primaryDisplay`) for screen titles, `size="section"` (15–18, `inkSecondary` +
  `primaryText`) for the small titles above cards. Tracking −0.02em. Screen readers get the full
  text as one header; the letters are `aria-hidden`. Reduce Motion shows it static. Used on the
  patient home and staff (Counter) home titles.
- **`ThemeToggle`** (`src/components/ThemeToggle.tsx`) — the web switch (apps/web
  `components/theme/ThemeToggle`) in Reanimated, at 60×30 with a 24px white raised knob. Light:
  knob left, track `#D9DDDA`, grey sun `#5b615d`. Dark: knob right, track `#7B3FE4`, violet moon.
  600 ms `cubic-bezier(0.65, 0, 0.35, 1)`: the knob slides and stretches to 1.15× mid-way, the
  track fades through `#B9A3F0`, and the outgoing icon leaves in the direction of travel as the
  new one enters, clipped to the knob (opacity and scale stand in for blur; no expo-blur). These
  violets live only in this component. `accessibilityRole="switch"` + `aria-checked`; Reduce
  Motion snaps. In the Settings Appearance card and in both home headers.
- **`QueueTracker`** (`src/components/motion/QueueTracker.tsx`) — the token screen's live tracker,
  apps/web's `/t/[id]` tracker in Reanimated, rendered only from props (no clock of its own). An ETA
  ring (`primary` arc on a `hairline` track, drawn as two clipped half-rings because
  react-native-svg is not installed), a queue lane (one `inkMuted` dot per person ahead up to 8,
  then `+N`, you in `primary` with a halo, the counter chip at the right; dots spring forward on a
  call and drop in with "Priority patient added"), the five-stage bar (Booked, Waiting, You're
  next, Called or With the doctor, Done; skipped/no-show/cancelled grey out and end in `danger`),
  and the now-serving line. Stage icons are expo-symbols (SF Symbols on iOS, Material Symbols on
  Android and web). The status mapping lives in `queue-lane.ts`, a copy of the web file with its
  node test. The halo gap is `canvasSoft`, the token screen's background.
- **Numbered card** — a large faint `primaryDisplay`-tinted number (`01`–`04` style, style.css's
  `.number_text`/`.care_text` pattern from index.html:221-241), a heading, a short line. Used for
  Home's service list — the pattern, not the literal MedWin icon set. At 18% opacity the number is
  decoration, not readable text, so no contrast target applies to it.
- **Card** — white `surface`, `hairline` border, soft shadow (`0 0 10px rgba(0,0,0,0.08)`-ish,
  derived from style.css:480/899's blurred/no-offset shadows), generous padding — MedWin leans on
  soft shadows and generous card padding, a step softer/roomier than this app's pre-redesign flat
  hairline-only cards.
- **Button (primary)** — filled `primary`, `onPrimary` text, uppercase `button` type, rounded
  corners (style.css:586 uses 8px on `.book_btn a`). **Never** `primary` or `primaryOutline` as
  text: on white they are 2.40:1 and 2.15:1, far under WCAG AA's 4.5:1. Large cyan words use
  `primaryDisplay`, and small cyan text and links use `primaryText`. `primary` is for fills, large
  graphics and button backgrounds; `primaryOutline` is for borders only.
- **Button (outline)** — transparent fill, `primaryOutline` border, per style.css:739-745's
  hover/active state on `.readmore_bt`.

Spacing/radius scales are unchanged from the pre-redesign `theme.ts` (`Spacing`, `Rounded`) — the
template's proportions don't call for new tokens, just softer shadows and roomier card padding
using the scales that already exist.

## UI kit (redesign)

`src/components/ui/`, imported from `@/components/ui`. Built for the Swiggy/Zomato-style patient
and payment screens; the gallery is the hidden route `/ui-kit` (`src/app/(app)/ui-kit.tsx`).

- **Type scale** (`Type`, `UIText`): body 17, secondary 15 (the floor: nothing in the kit is
  smaller), titles 22 / 28 / 34. Poppins 400/700, sentence case. Screen titles stay the uppercase
  AnimatedHeading.
- **Tap targets**: `MIN_TAP` 48. Button md is 48 tall, lg 56.
- **Department tones** (`Tones`, `toneFor`, `iconFor`): teal (the MedWin base), orange, rose,
  amber, green, blue, each a light and a dark two-stop gradient plus an icon colour. Tile text is
  `ink` on every stop (9.7:1 at worst); icons are 3.8:1 or better. Known departments map by
  keyword, anything else by a stable name hash. Violet stays reserved for ThemeToggle.
- **Gradients** (`gradient`, `cssGradient`): React Native's own `experimental_backgroundImage`
  linear-gradient on native, plain CSS on web. No gradient dependency.
- **Components**: `Button` (primary / secondary / ghost / danger, loading, haptic tap), `Card`
  (0.98 press scale), `DeptTile`, `DoctorCard`, `StatusChip`, `Skeleton`, `EmptyState`,
  `SectionHeader` (AnimatedHeading at a new 22pt `title` size), `StickyBottomBar` (+
  `useStickyBottomBarHeight`), and `useTabBarStyle` / `TAB_ICONS` for the NativeTabs bar.
- **Rules**: never nest a Button inside a pressable Card (screen readers lose the inner one;
  DoctorCard makes only its name row tappable for that reason). Every press animation and the
  skeleton shimmer stop under Reduce Motion.

## Dark-mode preference

`useColorScheme()` (`src/hooks/use-color-scheme.ts`, and its `.web.ts` twin) resolves a `"system" | "light" | "dark"` preference (default `"system"`) stored under
key `queueless-theme-preference` in `localStorage`. On native, that global comes from
`src/lib/storage-polyfill.ts` (expo-sqlite), the same one the Supabase client uses. On web it is
the browser's own, and during static rendering, where there is none, the preference falls back to
`"system"`. No new persistence dependency. `"system"` falls through to the OS scheme, and
`useTheme()` picks its palette from the resolved value. The value is read from storage once and
kept in memory; Settings' segments and every `ThemeToggle` subscribe to the same store.
