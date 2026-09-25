"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { errorInfo } from "@queueless/db"

import { createClient } from "@/lib/supabase/client"

import type { Appointment } from "./data"
import styles from "./History.module.css"
import { CalendarIcon } from "./icons"
import ui from "./ui.module.css"

// "Today, 5:00 PM" -> day + time, for the date tile.
function split(label: string): [string, string] {
  const cut = label.lastIndexOf(", ")
  return [label.slice(0, cut), label.slice(cut + 2)]
}

function AppointmentRow({ appt }: { appt: Appointment }) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [day, time] = split(appt.when)

  async function cancel() {
    setPending(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc("cancel_appointment", { p_appointment: appt.id })
    if (rpcError) {
      setError(errorInfo(rpcError.code || rpcError.message).message)
      setPending(false)
      return
    }
    router.refresh()
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
        {appt.doctor && <p className={styles.secondaryLine}>{appt.service}</p>}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      {appt.status === "pending_payment" ? (
        <span className={ui.chip} data-tone="warning">
          Awaiting payment
        </span>
      ) : confirming ? (
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

export function Appointments({ items }: { items: Appointment[] }) {
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
        <AppointmentRow key={a.id} appt={a} />
      ))}
    </ul>
  )
}
