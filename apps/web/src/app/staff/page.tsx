import type { Metadata } from "next"
import Link from "next/link"

import { LogoMark } from "@/components/brand/Logo"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"

import { LoginTabs } from "./LoginTabs"
import styles from "./staff.module.css"

export const metadata: Metadata = {
  title: "Sign in",
}

const TABS = ["google", "otp", "password"] as const
type Tab = (typeof TABS)[number]

// Empty (not "/my") when the caller didn't ask for a specific page: an empty
// `next` is what tells the sign-in actions "no explicit request, use the
// signed-in user's own role to pick /admin, /counter or /my" (see
// lib/auth/redirect.ts's roleLandingPath). Defaulting this to "/my" here
// would bake that default into the hidden form field before the role is
// even known, and permanently hide the role-based landing behind it.
function safeNextPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value
  if (!path || !path.startsWith("/") || path.startsWith("//")) return ""
  return path
}

function safeTab(value: string | string[] | undefined): Tab {
  const tab = Array.isArray(value) ? value[0] : value
  // "email" is the public name for the "otp" tab (its own key, and its
  // panel's label is "Email code") -- ?tab=email is what a link written by
  // someone who doesn't know the internal key would use.
  if (tab === "email") return "otp"
  return (TABS as readonly string[]).includes(tab ?? "") ? (tab as Tab) : "google"
}

export default async function StaffPage({ searchParams }: PageProps<"/staff">) {
  const params = await searchParams
  const next = safeNextPath(params.next)
  const initialTab = safeTab(params.tab)

  return (
    <>
      <PublicHeader current="login" />
      <main id="main" className={styles.page}>
        <div className={styles.band}>
          <span className={styles.bandMark} aria-hidden="true">
            <LogoMark size={220} />
          </span>
        </div>

        <div className={styles.card}>
          <TwoToneHeading as="h1" lead="Sign" accent="in" />
          <p className={styles.subtitle}>
            Patients sign in with Google or a one-time email code — no password, no separate
            sign-up. Staff and admin accounts sign in with the password an administrator gave
            them.
          </p>
          <LoginTabs next={next} initialTab={initialTab} />
        </div>

        <p className={styles.aside}>
          Here with a token? You don&apos;t need an account.{" "}
          <Link href="/#status">Check status</Link>
        </p>
      </main>
      <PublicFooter />
    </>
  )
}
