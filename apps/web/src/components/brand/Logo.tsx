// The Queueless mark: a Q whose loop is the line and whose tail is the token
// slip torn off and sliding out along the floor. Construction notes live in
// apps/web/brand/BRAND.md; static copies are in public/brand/.

// Ring in currentColor, slip in brand cyan. --brand-accent lets a screen
// override the slip (e.g. a one-colour print) without touching this file.
const ACCENT = "var(--brand-accent, #0cb7d6)";

// 18 x 16 unit grid (1 unit = 1px at 16px): ring r=8, stroke 3, centred at
// (8,8); tear gap 1; slip 3 high on the ring's baseline, running 2 past it.
const RING = "M8 16A8 8 0 1 1 14.928 12H11A5 5 0 1 0 8 13Z";
const SLIP = "M9 13h8a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9Z";

type LogoMarkProps = {
  /** Rendered height in px. Width follows the 18:16 grid. */
  size?: number;
  /** Accessible name. Omit when the mark is decorative (e.g. beside the wordmark). */
  title?: string;
  className?: string;
};

export function LogoMark({ size = 24, title, className }: LogoMarkProps) {
  const a11y = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true } as const);
  return (
    <svg
      viewBox="0 0 18 16"
      width={(size * 18) / 16}
      height={size}
      className={className}
      {...a11y}
    >
      {title ? <title>{title}</title> : null}
      <path d={RING} fill="currentColor" />
      <path d={SLIP} style={{ fill: ACCENT }} />
    </svg>
  );
}

type LogoProps = {
  /** Mark height in px; the wordmark's font-size matches it, so the caps centre on the ring. */
  size?: number;
  className?: string;
};

export function Logo({ size = 28, className }: LogoProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.3,
        fontFamily:
          "var(--font-poppins, Poppins), var(--font-inter, Inter), system-ui, sans-serif",
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: "-0.01em",
        whiteSpace: "nowrap",
      }}
    >
      <LogoMark size={size} />
      Queueless
    </span>
  );
}
