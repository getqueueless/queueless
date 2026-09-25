"use client";

import { useEffect } from "react";

import { Logo } from "@/components/brand/Logo";
import { AnimatedHeading } from "@/components/motion/AnimatedHeading";
import styles from "./states.module.css";

// Client component, so no async PublicHeader here: a self-contained card.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className={styles.center}>
      <div className={styles.card}>
        <Logo size={26} />
        <AnimatedHeading as="h1" lead="Something went" accent="wrong" align="center" />
        <p className={styles.text}>This page could not load right now, so please try again.</p>
        <div className={styles.actions}>
          <button type="button" onClick={() => retry()} className={`${styles.btn} ${styles.btnAccent}`}>
            Try again
          </button>
          {/* Plain <a> on purpose: a full reload clears whatever state broke. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={`${styles.btn} ${styles.btnOutline}`}>
            Back to home
          </a>
        </div>
      </div>
    </main>
  );
}
