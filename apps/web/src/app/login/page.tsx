import type { Metadata } from "next"
import Link from "next/link"

import { LogoMark } from "@/components/brand/Logo"
import { PublicFooter } from "@/components/site/PublicFooter"
import { PublicHeader } from "@/components/site/PublicHeader"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"

import { LoginForm } from "./login-form"
import styles from "./login.module.css"

export const metadata: Metadata = {
  title: "Sign in | Queueless",
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
            <LogoMark size={220} />
          </span>
        </div>

        <div className={styles.card}>
          <TwoToneHeading as="h1" lead="Staff" accent="sign in" />
          <p className={styles.subtitle}>
            Staff accounts are created by an administrator. You can’t sign up here, so
            ask your admin if you need access.
          </p>
          <LoginForm next={next} />
        </div>

        <p className={styles.aside}>
          Here with a token? You don’t need an account.{" "}
          <Link href="/#status">Check status</Link>
        </p>
      </main>
      <PublicFooter />
    </>
  )
}
