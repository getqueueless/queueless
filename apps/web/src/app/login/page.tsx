import type { Metadata } from "next"
import Link from "next/link"

import { LogoMark } from "@/components/brand/Logo"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"

import { LoginForm } from "./login-form"
import styles from "./login.module.css"

export const metadata: Metadata = {
  title: "Sign in — Queueless",
}

function safeNextPath(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    return "/"
  }
  return path
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams
  const next = safeNextPath(params.next)

  return (
    <>
      <PublicHeader current="login" />
      <main id="main" className={styles.page}>
        <div className={styles.band}>
          <span className={styles.bandMark} aria-hidden="true">
            <LogoMark size={300} />
          </span>
          <p className={styles.eyebrow}>For counter staff and admins</p>
        </div>

        <div className={styles.card}>
          <TwoToneHeading as="h1" lead="Staff" accent="sign in" />
          <p className={styles.subtitle}>
            Staff accounts are created by an administrator — there&apos;s no
            self-service sign-up. Contact your admin if you need access.
          </p>
          <LoginForm next={next} />
        </div>

        <p className={styles.aside}>
          Here with a token? You don&apos;t need an account.{" "}
          <Link href="/#status">Check your status</Link>
        </p>
      </main>
      <PublicFooter />
    </>
  )
}
