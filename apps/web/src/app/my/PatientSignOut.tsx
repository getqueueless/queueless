"use client"

import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"

import styles from "./my.module.css"

export function PatientSignOut() {
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  return (
    <button type="button" className={styles.signOut} onClick={signOut}>
      Sign out
    </button>
  )
}
