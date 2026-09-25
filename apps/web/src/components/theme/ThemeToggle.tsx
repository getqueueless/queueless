"use client";

import { useLayoutEffect, useState, useSyncExternalStore, type MouseEvent } from "react";
import styles from "./ThemeToggle.module.css";

// Must match THEME_SCRIPT in src/app/layout.tsx.
const KEY = "queueless-theme";
type Theme = "light" | "dark";

// The <html data-theme> attribute is the single source of truth; watching it
// keeps every toggle on the page in sync.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const readTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const serverTheme = (): Theme => "light";

// The switch from the Scene.mp4 reference. Its look is keyed off
// :root[data-theme] in CSS, not aria-checked, so the first paint is already
// right and hydration never plays the slide. `anim` is set only by a click:
// it names the direction, which (re)starts the stretch and lavender keyframes.
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const [anim, setAnim] = useState<Theme | null>(null);

  // Dev-only: Strict Mode's remount strips the attribute the head script set.
  // In production this re-applies the value that is already there.
  useLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === "dark" || stored === "light") document.documentElement.dataset.theme = stored;
    } catch {}
  }, []);

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    const root = document.documentElement;
    const next: Theme = readTheme() === "dark" ? "light" : "dark";
    const apply = () => {
      root.dataset.theme = next;
      try {
        localStorage.setItem(KEY, next);
      } catch {}
    };
    setAnim(next);

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();

    // No View Transitions (older Firefox): every colour eases over 350ms.
    if (!document.startViewTransition) {
      root.classList.add("theme-fading");
      apply();
      setTimeout(() => root.classList.remove("theme-fading"), 350);
      return;
    }

    // The whole page: the new theme is revealed in a circle growing out of
    // this switch until it covers the farthest corner of the viewport.
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 450, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label="Dark mode"
      onClick={toggle}
      data-anim={anim ?? undefined}
      className={className ? `${styles.toggle} ${className}` : styles.toggle}
    >
      <span className={styles.knob} aria-hidden="true">
        <svg className={`${styles.icon} ${styles.sun}`} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg className={`${styles.icon} ${styles.moon}`} viewBox="0 0 24 24">
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
        </svg>
      </span>
    </button>
  );
}
