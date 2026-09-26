"use client"

import { useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { describeSupabaseError } from "../_lib/describe-error"
import type { OrganizationRow } from "../_lib/types"
import styles from "../admin.module.css"

// Effective "now" if a demo clock is set: the fake time plus however much real
// time has passed since it was set (it ticks, it isn't frozen). Mirrors
// private.org_now() (0079) so this readout matches what the booking gate sees.
function effectiveNow(demoClockAt: string | null, demoClockSetAt: string | null): Date {
  if (!demoClockAt || !demoClockSetAt) return new Date()
  const elapsed = Date.now() - new Date(demoClockSetAt).getTime()
  return new Date(new Date(demoClockAt).getTime() + elapsed)
}

// Local <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm") from a Date, in the org's own
// timezone -- setting "9:00 AM" should mean 9 AM at the hospital, not in the browser's zone.
function toLocalInputValue(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
}

// The reverse: a "YYYY-MM-DDTHH:mm" string, read as wall-clock time in `timeZone`, to a real UTC
// instant. Built from an offset probe rather than a library -- one timezone, one small function.
function fromLocalInputValue(value: string, timeZone: string): Date {
  const naive = new Date(`${value}:00Z`)
  const asIfUtc = new Date(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(naive),
  )
  const offset = naive.getTime() - asIfUtc.getTime()
  return new Date(naive.getTime() + offset)
}

export function DemoClockSettings({ org }: { org: OrganizationRow }) {
  const [demoClockAt, setDemoClockAt] = useState(org.demo_clock_at)
  const [demoClockSetAt, setDemoClockSetAt] = useState(org.demo_clock_set_at)
  const [input, setInput] = useState(() => toLocalInputValue(effectiveNow(org.demo_clock_at, org.demo_clock_set_at), org.timezone))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()
  const active = demoClockAt != null

  async function apply(at: Date | null) {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc("set_demo_clock", { p_at: at ? at.toISOString() : null })
    setBusy(false)
    if (err) {
      setError(describeSupabaseError(err))
      return
    }
    setDemoClockAt(at ? at.toISOString() : null)
    setDemoClockSetAt(at ? new Date().toISOString() : null)
  }

  async function onSet(e: React.FormEvent) {
    e.preventDefault()
    await apply(fromLocalInputValue(input, org.timezone))
  }

  return (
    <section className={styles.card} aria-labelledby="demo-clock-title">
      <h2 id="demo-clock-title" className={styles.cardTitle}>
        Demo clock
      </h2>
      <p className={styles.hint} style={{ marginBottom: "var(--space-md)" }}>
        Overrides the time doctor working-hours checks see, so walk-ins can be taken during a demo held outside real
        shift hours. Nothing else (payments, holds, timestamps) is affected. It keeps ticking forward once set, it
        isn&apos;t frozen.
      </p>
      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
          {error}
        </div>
      )}
      <div role="status">
        <div className={styles.banner} data-active={active || undefined}>
          {active
            ? `Demo clock is ON, set to ${effectiveNow(demoClockAt, demoClockSetAt).toLocaleString("en-IN", { timeZone: org.timezone, dateStyle: "medium", timeStyle: "short" })} (${org.timezone}) and counting.`
            : `Real time (${org.timezone}) is in effect.`}
        </div>
      </div>
      <form className={styles.form} onSubmit={onSet}>
        <div className={styles.field}>
          <label htmlFor="demo-clock-input">Set the clock to</label>
          <input
            id="demo-clock-input"
            type="datetime-local"
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className={styles.buttonRow}>
          <button type="submit" className={styles.buttonPrimary} disabled={busy}>
            {busy ? "Saving…" : "Set demo clock"}
          </button>
          {active && (
            <button type="button" className={styles.buttonSecondary} onClick={() => void apply(null)} disabled={busy}>
              Resume real time
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
