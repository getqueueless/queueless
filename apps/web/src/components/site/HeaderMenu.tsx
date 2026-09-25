"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import styles from "./PublicHeader.module.css";

// The header's nav, plus the menu button that shows it below 1024px. From
// 1024px the button is hidden and the nav sits inline, so this state only
// matters on phones and tablets. A tap on any link or button inside closes
// it (same-page hash links included), and so does Escape.
export function HeaderMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function closeOnAction(event: MouseEvent) {
    if ((event.target as HTMLElement).closest("a, button")) setOpen(false);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label="Menu"
        onClick={() => setOpen(!open)}
      >
        <span className={styles.menuBars} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      <nav id="site-menu" aria-label="Main" className={styles.nav} data-open={open || undefined} onClick={closeOnAction}>
        {children}
      </nav>
    </>
  );
}
