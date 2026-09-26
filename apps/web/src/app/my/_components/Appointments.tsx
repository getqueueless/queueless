"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"

import { actionErrorText, cancelErrorText, CancelButton, cancelHold, HOLD_OUTCOME, Toast } from "./CancelButton"
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

// What happens to the money, said before the patient confirms. Matches
// cancel_appointment (0059): a paid slot cancelled 2+ hours ahead is refunded
// automatically; closer than that, only the hospital can approve one. A
// doctor's leave refunds automatically either way.
const REFUND_WINDOW_MS = 2 * 60 * 60 * 1000

function outcome(appt: Appointment) {
  if (appt.state === "paid") {
    const paid = `You paid${appt.feeInr ? ` ₹${appt.feeInr}` : ""} online.`
    const early = new Date(appt.startsAt).getTime() - Date.now() >= REFUND_WINDOW_MS
    return (
      <>
        <p>
          {early
            ? `${paid} Cancelling now refunds you automatically. It will land back on your card in a few days.`
            : `${paid} Cancelling this close to your slot does not refund you automatically: refunds are approved by the hospital, so ask at reception.`}
        </p>
        <p>If the doctor goes on leave that day, you are refunded automatically.</p>
      </>
    )
  }
  return <p>Nothing was charged for this booking, so there is nothing to refund.</p>
}

// check_in (0077) opens when the hospital's day starts on the appointment's
// own day (IST service day) and closes 15 minutes after the slot.
const CLOSES_MS = 15 * 60_000
const istDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms))
const CHECKIN_ERRORS: Record<string, string> = {
  checkin_window: "Check-in opens on the day of your appointment and closes 15 minutes after your slot.",
  rate_limited: "Too many tries, wait a bit.",
}

/** "in 2 h 43 m", "in 12 m", "now", "started 5 m ago". */
function countdown(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000)
  const span =
    m >= 1440
      ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`
      : m >= 60
        ? `${Math.floor(m / 60)} h ${m % 60} m`
        : `${m} m`
  if (m === 0) return "now"
  return ms > 0 ? `in ${span}` : `started ${span} ago`
}

function AppointmentRow({
  appt,
  now,
  onCancelled,
  onExpire,
}: {
  appt: Appointment
  now: number | null
  onCancelled: () => void
  onExpire: () => void
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [day, time] = split(appt.when)
  const chip = CHIP[appt.state]
  const start = new Date(appt.startsAt).getTime()
  const confirmed = appt.state === "paid" || appt.state === "booked"
  const canCheckIn = now !== null && istDay(now) === istDay(start) && now <= start + CLOSES_MS
  const started = now !== null && now >= start

  async function checkIn() {
    setChecking(true)
    setCheckError(null)
    try {
      const { data, error } = await supabase.rpc("check_in", { p_appointment: appt.id })
      if (error || !data?.id) {
        setCheckError(actionErrorText(error, CHECKIN_ERRORS, "Couldn't check in right now. Try again, or ask at reception."))
        setChecking(false)
        return
      }
      router.push(`/t/${data.id}`)
    } catch {
      setCheckError("Couldn't check in right now. Try again, or ask at reception.")
      setChecking(false)
    }
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
          {now !== null && <span className={styles.countdown}>{countdown(start - now)}</span>}
        </div>
        {appt.doctorLine && (
          <p className={styles.doctorLine} data-tone={appt.doctorLine.tone}>
            {appt.doctorLine.text}
          </p>
        )}
        {confirmed && (
          <p className={styles.explain}>
            Check in any time on your appointment day, from when the hospital opens, to join the live queue. Your place follows your slot time.
          </p>
        )}
        {checkError && (
          <p role="alert" className={styles.error}>
            {checkError}
          </p>
        )}
        {appt.state === "pending" && appt.holdExpiresAt && (
          <>
            <HoldTimer expiresAt={appt.holdExpiresAt} onExpire={onExpire} />
            <p className={styles.secondaryLine}>
              Nothing charged yet. Unpaid, the slot is released at {holdEnds(appt.holdExpiresAt)}.
            </p>
          </>
        )}
      </div>
      {appt.state === "pending" ? (
        <div className={styles.actions}>
          <Link href={`/pay/${appt.id}`} className={styles.pay}>
            Pay now{appt.feeInr ? ` ₹${appt.feeInr}` : ""}
          </Link>
          <CancelButton
            label="Cancel hold"
            title="Cancel this hold?"
            outcome={<p>{HOLD_OUTCOME}</p>}
            confirmLabel="Cancel hold"
            run={() => cancelHold(supabase, appt.id)}
            onDone={onCancelled}
          />
        </div>
      ) : appt.state === "refunded" ? null : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.checkIn}
            onClick={checkIn}
            disabled={!canCheckIn || checking}
            title={canCheckIn ? undefined : "Opens on the day of your appointment"}
          >
            {checking
              ? "Checking in…"
              : canCheckIn
                ? "Check in"
                : "Check in on the day"}
          </button>
          {!started && (
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
        </div>
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
  // null on the server render, so countdowns never mismatch at hydration.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0)
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(tick)
    }
  }, [])

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
          <AppointmentRow key={a.id} appt={a} now={now} onCancelled={cancelled} onExpire={reload} />
        ))}
      </ul>
    </>
  )
}
