import type { Metadata } from "next"
import Link from "next/link"

import { LogoMark } from "@/components/brand/Logo"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"

import { LoginTabs, type Tab } from "../staff/LoginTabs"
import styles from "../staff/staff.module.css"

export const metadata: Metadata = {
  title: "Sign in to take a token",
}

const PATIENT_TABS: Tab[] = ["google", "otp"]

// Same "no explicit next means no explicit next" rule as /staff -- see that
// page's safeNextPath for why this must stay empty, not default to /my.
function safeNextPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value
  if (!path || !path.startsWith("/") || path.startsWith("//")) return ""
  return path
}

function safeTab(value: string | string[] | undefined): Tab {
  const tab = Array.isArray(value) ? value[0] : value
  if (tab === "email") return "otp"
  return (PATIENT_TABS as string[]).includes(tab ?? "") ? (tab as Tab) : "google"
}

// Patient-facing sign-in: Google or an email code only, Google first --
// patients never had a password to begin with. Staff/admin still sign in at
// /staff (linked from the footer's Staff column), which keeps its password
// tab; this page reuses that same LoginTabs component restricted to the two
// patient-safe methods rather than a second copy of GooglePanel/OtpPanel.
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams
  const next = safeNextPath(params.next)
  const initialTab = safeTab(params.tab)

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
          <TwoToneHeading as="h1" lead="Sign in to take a" accent="token" />
          <p className={styles.subtitle}>
            No password, no separate sign-up — continue with Google or a one-time email code.
          </p>
          <LoginTabs next={next} initialTab={initialTab} tabs={PATIENT_TABS} />
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
