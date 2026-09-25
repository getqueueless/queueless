# Queueless brand

## Strategy
- **Category:** public-service queue platform. The demo preset is a hospital OPD.
- **Audience:** patients, who are anxious, waiting and usually on a phone, and front-desk staff, whose work is fast and repetitive.
- **Promise:** *Take a token. Leave the line.* You are free while you wait.
- **Metaphor:** the token you take, and the line you leave.

## The mark: why it looks like this
It is built on an 18 x 16 grid, where 1 unit is 1 px at 16 px tall. Every straight edge sits on the pixel grid at 16 px and 32 px.

- **Ring (the line):** a circle of radius 8, stroke 3, centred at (8, 8). It is the queue that goes round and round.
- **Slip (the token):** a 3-unit-high bar at the same weight as the ring. It sits on the ring's baseline (y 13 to 16) and runs 2 units past the ring's right edge.
- **Tear:** a 1-unit gap separates the slip from the ring. It appears once as a vertical cut at the bottom and once above the slip, where the ring ends in a flat cut at y 12. The slip is torn off, not attached.
- **Reading:** a Q for Queueless whose tail is a ticket sliding out along the floor, away from the loop.
- **Details:** the torn end is square and the leading end has a 1-unit radius. Tickets have soft corners; tears don't.
- **Rejected:** a 45-degree tail. It read as the search (magnifier) icon at 16 px. Keep the tail horizontal and on the baseline.

| File | Use |
|---|---|
| `src/components/brand/Logo.tsx` | `<LogoMark size title? />` and `<Logo size />` in the app. The ring uses `currentColor` and the slip uses `var(--brand-accent, #0cb7d6)` |
| `public/brand/queueless-mark.svg` | Mark on light backgrounds (ink ring) |
| `public/brand/queueless-mark-inverse.svg` | Mark on dark or slate-teal backgrounds (white ring) |
| `public/brand/queueless-logo.svg` | Lockup with the wordmark converted to outlines, so it needs no font |
| `src/app/icon.svg` | App icon and favicon: the mark on a slate-teal tile, which works on any tab colour |

## Lockup, clear space, size
- **Lockup:** the wordmark's font size equals the mark height, the gap is 0.3 x the mark height, and the caps centre on the ring. `<Logo>` does all of this.
- **Clear space:** at least 6 units (two ring strokes, 3/8 of the mark height) on every side.
- **Minimum size:** the mark alone is 16 px tall; use the tile below that. In the lockup the mark is at least 20 px. In print the mark is at least 6 mm.

## Palette
| Name | Hex | Use |
|---|---|---|
| Cyan | `#0cb7d6` | The slip, fills and large display words. 5.63:1 on slate-teal, **2.40:1 on white**, so never use it for small text on white |
| Cyan text | `#088197` | Small text and links on white (4.57:1) |
| Slate-teal | `#1a3237` | TV display board, icon tile, dark sections. White on it is 13.5:1 |
| Ink | `#252525` | Ring on light backgrounds and body text (15.3:1 on white). Text on cyan fills (6.39:1) |
| White | `#ffffff` | Base colour, and the ring on dark backgrounds |

## Type
- **Poppins 700:** the wordmark and display headings. Headings are uppercase with a cyan second word.
- **Poppins 400:** public-screen copy.
- **Inter:** dense staff UI (counter, admin).
- **Wordmark:** "Queueless" in mixed case, Poppins Bold, tracking -0.01em. Don't retype it in another font. Outside the app, use the outlined `queueless-logo.svg`.

## Tagline
**Take a token. Leave the line.**

## Do / don't
- **Do:** set the ring in the surface's text colour and keep the slip cyan.
- **Do:** use the tile icon wherever the background is unknown.
- **Do:** for one-colour print, set `--brand-accent: currentColor`.
- **Don't:** tilt the slip. At 45 degrees the mark reads as a search icon.
- **Don't:** close the tear gap, colour the ring cyan, or stretch the mark.
- **Don't:** add outlines, shadows or gradients.
- **Don't:** put white text on cyan. It is 2.40:1 and fails AA at every size; use ink instead.
- **Don't:** put the mark on a photo without a slate-teal overlay.
