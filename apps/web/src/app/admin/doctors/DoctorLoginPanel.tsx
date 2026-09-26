"use client"

import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import styles from "../admin.module.css"

// "Login" section on a doctor row: create a staff account for them (via the
// existing service-role /api/admin/staff route, which now also generates
// and returns a one-time temp password), then link it to this doctor row
// via set_doctor_user -- a new RPC from Hackathon database, not shipped yet.
// There's no doctors.user_id column live either, so this screen has no way
// to know a doctor is already linked; it always shows "Create login" for
// now. Reset/Unlink for an already-linked doctor land once that column and
// RPC exist -- no UI for them yet since they'd never have anything to act on.
export function DoctorLoginPanel({ doctorId, doctorName }: { doctorId: string; doctorName: string }) {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [shownPassword, setShownPassword] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function createLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      setError("Email is required.")
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)

    const res = await fetch("/api/admin/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), full_name: doctorName, role: "staff" }),
    })
    const body = await res.json()
    if (!res.ok) {
      setBusy(false)
      setError(body.error ?? "Couldn't create the login.")
      return
    }

    const supabase = createClient()
    const { error: linkError } = await supabase.rpc("set_doctor_user", { p_doctor: doctorId, p_user: body.id })
    setBusy(false)
    if (linkError) {
      // PGRST202/42883: the RPC isn't deployed yet -- same "not shipped"
      // convention as lib/rpc-availability.ts's callWhenAvailable, inlined
      // here since this is a one-off call, not a reusable wrapper.
      if (linkError.code === "PGRST202" || linkError.code === "42883") {
        setNote("Login created. Linking it to this doctor isn't available yet -- ask an admin to link it once that ships.")
      } else {
        setError(linkError.message)
      }
    }
    setShownPassword(body.password)
    setEmail("")
  }

  async function copyPassword() {
    if (!shownPassword) return
    try {
      await navigator.clipboard.writeText(shownPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied (permissions, non-secure context) --
      // the password is still shown on screen either way, just not copied.
    }
  }

  return (
    <section className={styles.card} aria-labelledby="doctor-login-title">
      <h2 id="doctor-login-title" className={styles.cardTitle}>
        Login for {doctorName}
      </h2>

      {shownPassword ? (
        <div className={styles.stack}>
          <div className={`${styles.banner} ${styles.bannerDanger}`}>
            This password is shown once and can&apos;t be retrieved again. Share it with {doctorName} securely
            (in person or a password manager) -- not over plain email or chat.
          </div>
          <div className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="doc-login-password">Temporary password</label>
              <div className={styles.buttonRow}>
                <input id="doc-login-password" readOnly className={styles.input} value={shownPassword} />
                <button type="button" className={styles.buttonSecondary} onClick={() => void copyPassword()}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <button type="button" className={styles.buttonSecondary} onClick={() => setShownPassword(null)}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className={styles.form} onSubmit={createLogin}>
          {error && (
            <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
              {error}
            </div>
          )}
          {note && <div className={styles.banner}>{note}</div>}
          <div className={styles.field}>
            <label htmlFor="doc-login-email">Email</label>
            <input
              id="doc-login-email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button type="submit" className={styles.buttonPrimary} disabled={busy}>
            {busy ? "Creating…" : "Create login"}
          </button>
        </form>
      )}
    </section>
  )
}
