import Link from "next/link";

import { Logo } from "@/components/brand/Logo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import styles from "./PublicHeader.module.css";

// "/#how" and "/#status" are landing-page sections: they must carry id="how"
// and id="status". /kiosk is not linked: it is a staff-signed-in device. The skip link needs the page's <main id="main">.
const NAV = [
  { key: "home", href: "/", label: "Home" },
  { key: "how", href: "/#how", label: "Get a token" },
  { key: "status", href: "/#status", label: "Check status" },
] as const;

type PublicHeaderProps = {
  /** The nav item for the page being shown; gets aria-current="page". */
  current?: "home" | "how" | "status" | "login";
  /** "surface" = white bar, ink text. "slate" = transparent, white text, for sitting on the hero overlay. */
  tone?: "surface" | "slate";
};

export function PublicHeader({ current, tone = "surface" }: PublicHeaderProps) {
  const page = (key: string) => (current === key ? ("page" as const) : undefined);
  return (
    <header className={tone === "slate" ? `${styles.header} ${styles.slate}` : styles.header}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <Logo size={26} />
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          {NAV.map((item) => (
            <Link key={item.key} href={item.href} aria-current={page(item.key)} className={styles.link}>
              {item.label}
            </Link>
          ))}
          <Link href="/login" aria-current={page("login")} className={styles.login}>
            Staff login
          </Link>
        </nav>
        <ThemeToggle className={styles.toggle} />
      </div>
    </header>
  );
}
