"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import styles from "./login.module.css"

export function AlreadySignedIn({ name, role, dashboardHref }: { name: string; role: string; dashboardHref: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOutAndSwitch() {
    setPending(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.refresh()
  }

  return (
    <div className={styles.form}>
      <p className={styles.prompt}>
        You&apos;re signed in as <strong>{name}</strong> ({role}).
      </p>
      <a href={dashboardHref} className={styles.submit} style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
        Continue to dashboard
      </a>
      <button type="button" className={styles.linkButton} onClick={() => void signOutAndSwitch()} disabled={pending}>
        {pending ? "Signing out…" : "Sign out and use another account"}
      </button>
    </div>
  )
}
