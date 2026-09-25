// WCAG 2.x contrast check for the color tokens in src/app/globals.css.
// Run from apps/web: `node brand/contrast-check.mjs`. Exits 1 if any pair
// falls below its minimum (4.5 body text, 3 large text / UI).
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const block = (sel) => {
  const body = css.split(sel + " {")[1].split("\n}")[0];
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
};
const light = block(":root");
const themes = { light, dark: { ...light, ...block(':root[data-theme="dark"]') } };

const lin = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum]
const PAIRS = [
  ["ink", "canvas", 4.5], ["ink", "canvas-soft", 4.5], ["ink", "surface", 4.5],
  ["ink-secondary", "surface", 4.5], ["ink-secondary", "canvas-soft", 4.5],
  ["ink-muted", "surface", 4.5], ["ink-muted", "canvas-soft", 4.5], ["ink-muted", "surface-sunken", 4.5],
  ["primary", "surface", 4.5], ["primary", "canvas-soft", 4.5], ["primary", "primary-soft", 4.5],
  ["on-primary", "primary", 4.5], ["on-primary", "primary-hover", 4.5], ["on-primary", "primary-press", 4.5],
  ["accent-display", "canvas", 3], ["accent-display", "canvas-soft", 3], ["accent-display", "surface", 3],
  ["on-accent", "accent", 4.5], ["on-accent", "accent-hover", 4.5],
  ["accent", "slate", 4.5], ["accent", "slate-deep", 4.5],
  ["on-slate", "slate", 4.5], ["on-slate", "slate-deep", 4.5], ["on-slate-muted", "slate", 4.5], ["on-slate-muted", "slate-deep", 4.5],
  ["success", "surface", 4.5], ["success", "success-soft", 4.5],
  ["warning", "surface", 4.5], ["warning", "warning-soft", 4.5],
  ["danger", "surface", 4.5], ["danger", "danger-soft", 4.5],
  ["focus-ring", "canvas", 3], ["focus-ring", "surface", 3], ["focus-ring", "canvas-soft", 3],
];

let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(t[`--color-${fg}`], t[`--color-${bg}`]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
  }
}
// Reference values from the MedWin template, for the record.
for (const [fg, bg] of [["#0cb7d6", "#ffffff"], ["#ffffff", "#0cb7d6"], ["#898989", "#ffffff"]]) {
  console.log(`ref  ${fg} on ${bg}: ${ratio(fg, bg).toFixed(2)}`);
}
process.exit(failed ? 1 : 0);
