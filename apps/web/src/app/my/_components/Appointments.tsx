"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { errorInfo } from "@queueless/db"

import { createClient } from "@/lib/supabase/client"

import { loadAppointments, type Appointment } from "./data"
import type { Tone } from "./format"
import styles from "./History.module.css"
import { CalendarIcon } from "./icons"
import ui from "./ui.module.css"

const CHIP: Record<Appointment["state"], { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "success" },
  booked: { label: "Booked", tone: "primary" },
  pending: { label: "Payment pending", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
}

// "Today, 5:00 PM" -> day + time, for the date tile.
function split(label: string): [string, string] {
  const cut = label.lastIndexOf(", ")
  return [label.slice(0, cut), label.slice(cut + 2)]
}

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** A hold's own countdown; when it lapses the list re-reads and the hold drops out. */
function HoldTimer({ expiresAt, onExpire }: { expiresAt: string; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const left = new Date(expiresAt).getTime() - now
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])
  useEffect(() => {
    if (left > 0) return
    const later = setTimeout(onExpire, 0)
    return () => clearTimeout(later)
  }, [left, onExpire])
  return <p className={styles.hold}>{left > 0 ? `Pay within ${clock(left)} to keep this slot` : "Hold expired"}</p>
}

function AppointmentRow({ appt, onChange }: { appt: Appointment; onChange: () => void }) {
  const [supabase] = useState(() => createClient())
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [day, time] = split(appt.when)
  const chip = CHIP[appt.state]
  // cancel_appointment (0013) only takes a booked appointment; an unpaid hold
  // simply lapses after its 10 minutes.
  const cancellable = appt.state === "paid" || appt.state === "booked"

  async function cancel() {
    setPending(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc("cancel_appointment", { p_appointment: appt.id })
    setPending(false)
    if (rpcError) {
      setError(errorInfo(rpcError.code || rpcError.message).message)
      return
    }
    setConfirming(false)
    onChange()
  }

  return (
    <li className={styles.row}>
      <div className={styles.when}>
        <span className={styles.whenDay}>{day}</span>
        <span className={styles.whenTime}>{time}</span>
      </div>
      <div className={styles.what}>
        <p className={styles.primaryLine} translate="no">
          {appt.doctor ?? appt.service}
        </p>
        <div className={styles.meta}>
          {appt.doctor && <span className={styles.secondaryLine}>{appt.service}</span>}
          <span className={ui.chip} data-tone={chip.tone}>
            {chip.label}
          </span>
        </div>
        {appt.state === "pending" && appt.holdExpiresAt && <HoldTimer expiresAt={appt.holdExpiresAt} onExpire={onChange} />}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      {appt.state === "pending" ? (
        <Link href={`/pay/${appt.id}`} className={styles.pay}>
          Pay now{appt.feeInr ? ` ₹${appt.feeInr}` : ""}
        </Link>
      ) : !cancellable ? null : confirming ? (
        <div className={styles.confirm} role="group" aria-label="Cancel this appointment?">
          <button type="button" className={styles.danger} onClick={cancel} disabled={pending}>
            {pending ? "Cancelling…" : "Yes, cancel"}
          </button>
          <button type="button" className={styles.quiet} onClick={() => setConfirming(false)} disabled={pending}>
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" className={styles.quiet} onClick={() => setConfirming(true)}>
          Cancel
        </button>
      )}
    </li>
  )
}

// Server-rendered first, then re-read in the browser on mount, on focus and
// after any change, so coming back from checkout (a Back press restores a
// cached copy of the page) or a second booking always lists every hold and
// booking the patient has.
export function Appointments({
  items: initial,
  userId,
  timeZone,
}: {
  items: Appointment[]
  userId: string | null
  timeZone: string
}) {
  const [supabase] = useState(() => createClient())
  const [items, setItems] = useState(initial)

  const reload = useCallback(() => {
    if (!userId) return
    loadAppointments(supabase, userId, timeZone, new Date()).then(setItems)
  }, [supabase, userId, timeZone])

  useEffect(() => {
    const first = setTimeout(reload, 0)
    const onVisible = () => {
      if (document.visibilityState === "visible") reload()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pageshow", reload)
    return () => {
      clearTimeout(first)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pageshow", reload)
    }
  }, [reload])

  if (items.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>
          <CalendarIcon />
        </span>
        <p>No upcoming appointments.</p>
        <a href="#doctors" className={styles.link}>
          Book a time with a doctor
        </a>
      </div>
    )
  }
  return (
    <ul className={styles.list}>
      {items.map((a) => (
        <AppointmentRow key={a.id} appt={a} onChange={reload} />
      ))}
    </ul>
  )
}
