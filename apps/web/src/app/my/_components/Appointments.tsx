"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"

import { cancelErrorText, CancelButton, Toast } from "./CancelButton"
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

function holdEnds(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

// What happens to the money, said before the patient confirms. Refunds follow
// docs/PAYMENTS.md: automatic only when the doctor goes on leave, otherwise
// approved by the hospital.
function outcome(appt: Appointment) {
  if (appt.state === "paid") {
    return (
      <>
        <p>
          You paid{appt.feeInr ? ` ₹${appt.feeInr}` : ""} online. Cancelling frees the slot but does not refund you
          automatically: refunds are approved by the hospital, so ask at reception.
        </p>
        <p>If the doctor goes on leave that day, you are refunded automatically.</p>
      </>
    )
  }
  return <p>Nothing was charged for this booking, so there is nothing to refund.</p>
}

function AppointmentRow({ appt, onCancelled, onExpire }: { appt: Appointment; onCancelled: () => void; onExpire: () => void }) {
  const [supabase] = useState(() => createClient())
  const [day, time] = split(appt.when)
  const chip = CHIP[appt.state]

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
        {appt.state === "pending" && appt.holdExpiresAt && (
          <>
            <HoldTimer expiresAt={appt.holdExpiresAt} onExpire={onExpire} />
            <p className={styles.secondaryLine}>
              Nothing charged yet. Don&apos;t want it? Skip paying and the slot is released at{" "}
              {holdEnds(appt.holdExpiresAt)}.
            </p>
          </>
        )}
      </div>
      {appt.state === "pending" ? (
        <Link href={`/pay/${appt.id}`} className={styles.pay}>
          Pay now{appt.feeInr ? ` ₹${appt.feeInr}` : ""}
        </Link>
      ) : appt.state === "refunded" ? null : (
        <CancelButton
          title="Cancel this appointment?"
          outcome={outcome(appt)}
          confirmLabel="Cancel appointment"
          run={async () => {
            const { error } = await supabase.rpc("cancel_appointment", { p_appointment: appt.id })
            return cancelErrorText(error)
          }}
          onDone={onCancelled}
        />
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
  const [toast, setToast] = useState<string | null>(null)

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

  useEffect(() => {
    if (!toast) return
    const hide = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(hide)
  }, [toast])

  function cancelled() {
    setToast("Appointment cancelled")
    reload()
  }

  if (items.length === 0) {
    return (
      <>
      <Toast message={toast} />
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>
          <CalendarIcon />
        </span>
        <p>No upcoming appointments.</p>
        <a href="#doctors" className={styles.link}>
          Book a time with a doctor
        </a>
      </div>
      </>
    )
  }
  return (
    <>
      <Toast message={toast} />
      <ul className={styles.list}>
        {items.map((a) => (
          <AppointmentRow key={a.id} appt={a} onCancelled={cancelled} onExpire={reload} />
        ))}
      </ul>
    </>
  )
}
