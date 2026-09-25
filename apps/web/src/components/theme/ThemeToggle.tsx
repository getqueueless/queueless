"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
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

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";

  // Dev-only: Strict Mode's remount strips the attribute the head script set.
  // In production this re-applies the value that is already there.
  useLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === "dark" || stored === "light") document.documentElement.dataset.theme = stored;
    } catch {}
  }, []);

  function toggle() {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
  }

  const label = `Switch to ${next} theme`;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={className ? `${styles.toggle} ${className}` : styles.toggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </>
        ) : (
          <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
        )}
      </svg>
    </button>
  );
}
