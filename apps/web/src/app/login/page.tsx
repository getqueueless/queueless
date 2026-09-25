import type { Metadata } from "next"

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
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>
          Staff accounts are created by an administrator — there&apos;s no
          self-service sign-up. Contact your admin if you need access.
        </p>
        <LoginForm next={next} />
      </div>
    </main>
  )
}
