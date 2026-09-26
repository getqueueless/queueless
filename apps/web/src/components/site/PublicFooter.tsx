import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";
import styles from "./PublicFooter.module.css";

const COLUMNS = [
  {
    heading: "Patients",
    links: [
      { href: "/login?next=/my", label: "Get a token" },
      { href: "/#status", label: "Check status" },
      { href: "/#get-app", label: "Get the app" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    heading: "Project",
    links: [
      { href: "https://lpu.lol", label: "lpu.lol" },
      { href: "https://github.com/getqueueless/queueless", label: "Source on GitHub" },
    ],
  },
];

type PublicFooterProps = {
  /** Photo credit line(s), e.g. <>Hero photo by <a href="…">Name</a> on Unsplash</>. Shown in the bottom bar. */
  credit?: ReactNode;
};

// Slate-deep footer with MedWin's cyan-dot column headings. Brand colours
// only, so it looks the same in both themes.
export function PublicFooter({ credit }: PublicFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.about}>
          <Logo size={26} />
          <p className={styles.tagline}>Take a token. Leave the line.</p>
          <p className={styles.blurb}>
            Queueless holds your place in the queue, so you can wait wherever you like and come back
            when you are called.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.heading} aria-labelledby={`footer-${col.heading.toLowerCase()}`} className={styles.column}>
            <h2 id={`footer-${col.heading.toLowerCase()}`} className={styles.heading}>
              {col.heading}
            </h2>
            <ul className={styles.list}>
              {col.links.map((link) => (
                <li key={link.href}>
                  {link.href.startsWith("https://") ? (
                    <a href={link.href} className={styles.link}>
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className={styles.link}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className={styles.bottom}>
        {/* Staff sign in through the same card as patients; this is their quiet way in. */}
        <p className={styles.legal}>
          © {new Date().getFullYear()} Queueless
          <Link href="/login" className={styles.staff}>
            Staff login
          </Link>
        </p>
        {credit ? <p className={styles.credit}>{credit}</p> : null}
      </div>
    </footer>
  );
}
