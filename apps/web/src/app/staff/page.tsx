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

function safeNextPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value
  if (!path || !path.startsWith("/") || path.startsWith("//")) return "/my"
  return path
}

function safeTab(value: string | string[] | undefined): Tab {
  const tab = Array.isArray(value) ? value[0] : value
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
