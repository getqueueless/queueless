import Link from "next/link";

import { AnimatedHeading } from "@/components/motion/AnimatedHeading";
import { PublicFooter } from "@/components/site/PublicFooter";
import { PublicHeader } from "@/components/site/PublicHeader";
import styles from "./states.module.css";

export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="main" className={styles.page}>
        <div className={styles.band}>
          <AnimatedHeading as="h1" lead="Page not" accent="found" onDark align="center" />
        </div>
        <div className={styles.card}>
          <p className={styles.text}>This link may be old or mistyped.</p>
          <div className={styles.actions}>
            <Link href="/" className={`${styles.btn} ${styles.btnAccent}`}>
              Back to home
            </Link>
            <Link href="/#status" className={`${styles.btn} ${styles.btnOutline}`}>
              Check your status
            </Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
