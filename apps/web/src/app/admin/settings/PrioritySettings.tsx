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
    <div style={{ display: "grid", gap: 24 }}>
      <div className={styles.card}>
        <div className={styles.pageSubtitle} style={{ marginBottom: 12 }}>
          Lanes, in priority order
        </div>
        <ol style={{ paddingLeft: 20, display: "grid", gap: 6 }}>
          {LANES.map((lane) => (
            <li key={lane} style={{ color: "var(--color-ink)" }}>
              {lane}
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.card}>
        <div className={styles.pageSubtitle} style={{ marginBottom: 12 }}>
          Priority head start
        </div>
        {error && (
          <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
            {error}
          </div>
        )}
        {saved && (
          <div role="status" className={styles.banner}>
            Saved.
          </div>
        )}
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label htmlFor="head-start">Minutes a priority-lane token is treated as having arrived earlier</label>
            <input
              id="head-start"
              type="number"
              min={0}
              className={styles.input}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
          <div className={styles.buttonRow}>
            <button type="submit" className={styles.buttonPrimary} disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
