import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/brand/Logo";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { loadLiveToken } from "@/components/tokens/active-token";
import { ActiveTokenBar } from "@/components/tokens/ActiveTokenBar";
import { roleLandingPath } from "@/lib/auth/redirect";
import { getMyProfile } from "@/lib/supabase/get-role";
import { createClient } from "@/lib/supabase/server";
import { HeaderMenu } from "./HeaderMenu";
import styles from "./PublicHeader.module.css";
import { BackButton } from "./BackButton";

// "/#status" is a landing-page section: it must carry id="status". "Get a
// token" matches the hero: patients take one from /my, via /login when
// signed out. /kiosk is not linked: it is a staff-signed-in device. The skip
// link needs the page's <main id="main">.
const NAV = [
  { key: "home", href: "/", label: "Home" },
  { key: "how", href: "/login?next=/my", label: "Get a token" },
  { key: "status", href: "/#status", label: "Check status" },
  { key: "app", href: "/#get-app", label: "Get app" },
  { key: "faq", href: "/faq", label: "FAQ" },
] as const;

type PublicHeaderProps = {
  /** The nav item for the page being shown; gets aria-current="page". */
  current?: "home" | "how" | "status" | "signin";
  /** "surface" = white bar, ink text. "slate" = transparent, white text, for sitting on the hero overlay. */
  tone?: "surface" | "slate";
  /** A signed-in patient's live token strip under the bar. Off where the page already is that status (/t/[id]). */
  liveToken?: boolean;
};

// Streams in after the header, so a slow token read never holds the page.
// Renders nothing when the patient has no active token.
async function LiveTokenBar() {
  const live = await loadLiveToken(await createClient());
  return <ActiveTokenBar key={live?.token.id ?? "none"} initial={live} />;
}

export async function PublicHeader({ current, tone = "surface", liveToken = true }: PublicHeaderProps) {
  const page = (key: string) => (current === key ? ("page" as const) : undefined);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const profile = user ? await getMyProfile(supabase, user.id) : null;
  const displayName = profile?.fullName ?? user?.email ?? null;

  return (
    <>
      <header className={tone === "slate" ? `${styles.header} ${styles.slate}` : styles.header}>
        <a href="#main" className={styles.skip}>
          Skip to content
        </a>
        <div className={styles.inner}>
          {/* Signed in, the logo is the way back to your own dashboard; "Home" stays "/". */}
          <div className={styles.brandWrap}>
            <BackButton />
            <Link href={user ? roleLandingPath(profile) : "/"} aria-label="WaitWise" className={styles.brand}>
              <Logo size={26} />
            </Link>
          </div>
          <HeaderMenu>
            {NAV.map((item) => (
              <Link
                key={item.key}
                href={item.key === "how" && user ? "/my" : item.href}
                aria-current={page(item.key)}
                className={item.key === "faq" ? `${styles.link} ${styles.menuOnly}` : styles.link}
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
      {liveToken && profile?.role === "patient" && (
        <Suspense fallback={null}>
          <LiveTokenBar />
        </Suspense>
      )}
    </>
  );
}
