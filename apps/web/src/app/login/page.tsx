import type { Metadata } from "next"
import Link from "next/link"

import { LogoMark } from "@/components/brand/Logo"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"

import { LoginCard } from "./LoginCard"
import styles from "./login.module.css"

export const metadata: Metadata = {
  title: "Sign in to Queueless",
}

// Empty (not a default page) when the caller didn't ask for a specific
// page: an empty `next` is what tells the sign-in actions "no explicit
// request, use the signed-in user's own role to pick /admin, /counter or
// /my" (see lib/auth/redirect.ts's roleLandingPath).
function safeNextPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\x00-\x1f]/.test(path)) return ""
  return path
}

// One card, every role (GitHub-style): password sign-in by default, with
// Google, an email sign-in code and account creation reachable from the
// same card. /staff redirects here; there's no separate staff surface any
// more.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams
  const next = safeNextPath(params.next)

  return (
    <>
      <PublicHeader current="signin" />
      <main id="main" className={styles.page}>
        <div className={styles.band}>
          <span className={styles.bandMark} aria-hidden="true">
            <LogoMark size={220} />
          </span>
        </div>

        <div className={styles.card}>
          <div className={styles.header}>
            <LogoMark size={32} />
            <h1 className={styles.heading}>
              Sign in to <span className={styles.accent}>Queueless</span>
            </h1>
          </div>
          <LoginCard next={next} />
        </div>

        <p className={styles.aside}>
          Here with a token already? You don&apos;t need an account.{" "}
          <Link href="/#status">Check status</Link>
        </p>
      </main>
      <PublicFooter />
    </>
  )
}
