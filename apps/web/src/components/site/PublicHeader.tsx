import Link from "next/link";

import { Logo } from "@/components/brand/Logo";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { roleLandingPath } from "@/lib/auth/redirect";
import { getMyProfile } from "@/lib/supabase/get-role";
import { createClient } from "@/lib/supabase/server";
import { HeaderMenu } from "./HeaderMenu";
import styles from "./PublicHeader.module.css";

// "/#status" is a landing-page section: it must carry id="status". "Get a
// token" matches the hero: patients take one from /my, via /login when
// signed out. /kiosk is not linked: it is a staff-signed-in device. The skip
// link needs the page's <main id="main">.
const NAV = [
  { key: "home", href: "/", label: "Home" },
  { key: "how", href: "/login?next=/my", label: "Get a token" },
  { key: "status", href: "/#status", label: "Check status" },
] as const;

type PublicHeaderProps = {
  /** The nav item for the page being shown; gets aria-current="page". */
  current?: "home" | "how" | "status" | "signin";
  /** "surface" = white bar, ink text. "slate" = transparent, white text, for sitting on the hero overlay. */
  tone?: "surface" | "slate";
};

export async function PublicHeader({ current, tone = "surface" }: PublicHeaderProps) {
  const page = (key: string) => (current === key ? ("page" as const) : undefined);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getMyProfile(supabase, user.id) : null;
  const displayName = profile?.fullName ?? user?.email ?? null;

  return (
    <header className={tone === "slate" ? `${styles.header} ${styles.slate}` : styles.header}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand}>
          <Logo size={26} />
        </Link>
        <HeaderMenu>
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.key === "how" && user ? "/my" : item.href}
              aria-current={page(item.key)}
              className={styles.link}
            >
              {item.label}
            </Link>
          ))}
          {user ? (
            <>
              {displayName && <span className={styles.userName}>{displayName}</span>}
              <Link href={roleLandingPath(profile)} className={styles.login}>
                Dashboard
              </Link>
              <SignOutButton className={styles.signOut} redirectTo="/" />
            </>
          ) : (
            <Link href="/login" aria-current={page("signin")} className={styles.login}>
              Log in
            </Link>
          )}
        </HeaderMenu>
        <ThemeToggle className={styles.toggle} />
      </div>
    </header>
  );
}
