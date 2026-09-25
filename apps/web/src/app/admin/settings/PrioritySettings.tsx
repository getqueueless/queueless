"use client"

import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { describeSupabaseError } from "../_lib/describe-error"
import type { OrganizationRow } from "../_lib/types"
import styles from "../admin.module.css"

// Fixed by the `lane` enum (supabase/migrations/0001_enums.sql) -- ordered by
// how the DB agent's queue ordering treats them (emergency first). There is
// no table to CRUD here; this is a read-only reference, not a form.
const LANES = ["emergency", "senior", "pregnant", "appointment", "normal"] as const

export function PrioritySettings({ org }: { org: OrganizationRow }) {
  const [minutes, setMinutes] = useState(String(org.priority_head_start_minutes))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const supabase = createClient()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    const value = Number(minutes)
    if (!Number.isFinite(value) || value < 0) {
      setError("Enter a non-negative number of minutes.")
      return
    }

    setBusy(true)
    const { error } = await supabase.from("organizations").update({ priority_head_start_minutes: value }).eq("id", org.id)
    setBusy(false)
    if (error) {
      setError(describeSupabaseError(error))
      return
    }
    setSaved(true)
  }

  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="lanes-title">
        <h2 id="lanes-title" className={styles.cardTitle}>
          Lanes, in priority order
        </h2>
        <ol className={styles.lanes}>
          {LANES.map((lane) => (
            <li key={lane}>{lane}</li>
          ))}
        </ol>
      </section>

      <section className={styles.card} aria-labelledby="head-start-title">
        <h2 id="head-start-title" className={styles.cardTitle}>
          Priority head start
        </h2>
        {error && (
          <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
            {error}
          </div>
        )}
        {/* Mounted up front so "saved" is announced when it appears. */}
        <div role="status">{saved && <div className={styles.banner}>Head start saved.</div>}</div>
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label htmlFor="head-start">Head start (minutes)</label>
            <input
              id="head-start"
              name="head_start_minutes"
              type="number"
              inputMode="numeric"
              min={0}
              autoComplete="off"
              className={styles.input}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-describedby="head-start-hint"
            />
            <p id="head-start-hint" className={styles.hint}>
              How many minutes earlier a priority-lane token is treated as having arrived.
            </p>
          </div>
          <div className={styles.buttonRow}>
            <button type="submit" className={styles.buttonPrimary} disabled={busy}>
              {busy ? "Saving…" : "Save head start"}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
