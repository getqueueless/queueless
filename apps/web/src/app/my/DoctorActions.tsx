"use client"

import { useRouter } from "next/navigation"
import { useEffect, useId, useMemo, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import type { DashboardDoctor, Slot } from "./_components/data"
import styles from "./_components/Doctors.module.css"
import { actionErrorText, Toast } from "./_components/CancelButton"
import { AVAILABILITY_TONE, initials } from "./_components/format"
import { CalendarIcon, ClockIcon, SearchIcon } from "./_components/icons"
import { PriorityStep, type PriorityChoice } from "./_components/PriorityStep"
import ui from "./_components/ui.module.css"

const FIRST_SLOTS = 6

// Booking codes worth our own words (0057/0068/0069); every other failure shows
// the server's message or BOOK_FALLBACK, never nothing.
const HOLD_ERRORS: Record<string, string> = {
  too_many_holds: "You already have 2 unpaid bookings. Pay or cancel one first.",
  rate_limited: "Too many tries, wait a bit.",
}
const BOOK_FALLBACK = "Couldn't book right now. Try again in a few minutes."

function bookingErrorText(error: { code?: string; message?: string } | null): string {
  // time_clash's own message names the clashing time ("You already have a booking at 10:00").
  if (error?.code === "time_clash") return error.message || "You already have a booking at that time."
  return actionErrorText(error, HOLD_ERRORS, BOOK_FALLBACK)
}

// "Today, 5:00 PM" -> ["Today", "5:00 PM"]; slots arrive soonest first, so
// consecutive runs share a day.
function byDay(slots: Slot[]): { day: string; slots: (Slot & { time: string })[] }[] {
  const days: { day: string; slots: (Slot & { time: string })[] }[] = []
  for (const slot of slots) {
    const cut = slot.label.lastIndexOf(", ")
    const day = slot.label.slice(0, cut)
    if (days.at(-1)?.day !== day) days.push({ day, slots: [] })
    days.at(-1)!.slots.push({ ...slot, time: slot.label.slice(cut + 2) })
  }
  return days
}

// The requested lane rides along on the hold; staff confirm it at the counter.
// Senior goes as normal: the server applies it from the date of birth (0072).
function priorityArgs(choice: PriorityChoice) {
  return {
    p_requested_lane: choice.lane === "senior" ? "normal" : choice.lane,
    p_note: choice.lane === "normal" ? null : choice.note || null,
  }
}

function DoctorCard({
  doctor: d,
  seniorAuto,
  onError,
}: {
  doctor: DashboardDoctor
  seniorAuto: boolean
  onError: (text: string) => void
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [taking, setTaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // What the priority step is about to hold: a walk-in token or a slot.
  const [ask, setAsk] = useState<{ kind: "token" } | { kind: "slot"; slot: Slot } | null>(null)
  const panelId = useId()
  const a = d.availability
  const off = !a.bookable
  const next = d.slots[0]

  function fail(text: string) {
    setError(text)
    onError(text)
  }

  // Booking is paid (0068): hold the slot for 10 minutes, then pay on /pay/<id>.
  async function book(slot: Slot, choice: PriorityChoice) {
    setError(null)
    setPending(slot.id)
    try {
      const { data, error: rpcError } = await supabase.rpc("start_paid_appointment", {
        p_slot: slot.id,
        ...priorityArgs(choice),
      })
      if (rpcError || !data?.id) {
        fail(bookingErrorText(rpcError))
        setPending(null)
        return
      }
      router.push(`/pay/${data.id}`)
    } catch {
      fail(BOOK_FALLBACK)
      setPending(null)
    }
  }

  // Same hold-then-pay flow as BookAndPayButton (start_paid_booking), with the
  // errors this list needs: shown inline and as a toast, never swallowed.
  async function takeToken(choice: PriorityChoice) {
    setError(null)
    setTaking(true)
    try {
      const { data, error: rpcError } = await supabase.rpc("start_paid_booking", {
        p_doctor_id: d.id,
        ...priorityArgs(choice),
      })
      if (rpcError || !data?.id) {
        fail(bookingErrorText(rpcError))
        setTaking(false)
        return
      }
      router.push(`/pay/${data.id}`)
    } catch {
      fail(BOOK_FALLBACK)
      setTaking(false)
    }
  }

  return (
    <li className={styles.card} data-off={off || undefined}>
      <div className={styles.top}>
        <span className={styles.avatar} aria-hidden="true">
          {initials(d.name)}
        </span>
        <div className={styles.who}>
          <h3 className={styles.name} translate="no">
            {d.name}
          </h3>
          <p className={styles.spec}>
            {d.specialty}
            {d.specialty !== d.serviceName && d.serviceName ? `, ${d.serviceName}` : ""}
          </p>
        </div>
        <p className={styles.fee}>
          <span className={ui.srOnly}>Fee </span>₹{d.feeInr}
        </p>
      </div>

      <div className={styles.status}>
        <span className={ui.chip} data-tone={AVAILABILITY_TONE[a.kind]}>
          {a.label}
        </span>
        {d.room && <span className={styles.room}>Room {d.room}</span>}
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>
            <ClockIcon />
            Today
          </dt>
          <dd>{d.hours || "No clinic hours"}</dd>
        </div>
        <div>
          <dt>
            <CalendarIcon size={16} />
            Next free
          </dt>
          <dd>{off ? "Not today" : (next?.label ?? "No open slots soon")}</dd>
        </div>
      </dl>

      {off && <p className={styles.reason}>{a.kind === "leave" ? `Reason: ${a.reason}` : a.reason}</p>}

      <div className={styles.actions}>
        {off ? (
          <button type="button" className={styles.primary} disabled>
            Take token
          </button>
        ) : (
          <button type="button" className={styles.primary} onClick={() => setAsk({ kind: "token" })} disabled={taking}>
            {taking ? "Holding your spot…" : "Take token"}
          </button>
        )}
        <button
          type="button"
          className={styles.secondary}
          aria-expanded={open}
          aria-controls={panelId}
          disabled={off || d.slots.length === 0}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide times" : `Book · ₹${d.feeInr}`}
        </button>
      </div>

      <div id={panelId} className={styles.slots} hidden={!open}>
        {byDay(more ? d.slots : d.slots.slice(0, FIRST_SLOTS)).map((group) => (
          <div key={group.day} role="group" aria-label={group.day}>
            <p className={styles.day}>{group.day}</p>
            <ul className={styles.pills}>
              {group.slots.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={styles.pill}
                    disabled={pending !== null}
                    aria-label={`Book ${s.label}, pay ₹${d.feeInr}`}
                    onClick={() => setAsk({ kind: "slot", slot: s })}
                  >
                    {pending === s.id ? "Holding…" : s.time}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!more && d.slots.length > FIRST_SLOTS && (
          <button type="button" className={styles.moreTimes} onClick={() => setMore(true)}>
            More times
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <PriorityStep
        open={ask !== null}
        seniorAuto={seniorAuto}
        actionLabel={`Continue to pay ₹${d.feeInr}`}
        onCancel={() => setAsk(null)}
        onContinue={(choice) => {
          const next = ask
          setAsk(null)
          if (next?.kind === "token") takeToken(choice)
          else if (next?.kind === "slot") book(next.slot, choice)
        }}
      />
    </li>
  )
}

export function DoctorActions({ doctors, seniorAuto = false }: { doctors: DashboardDoctor[]; seniorAuto?: boolean }) {
  const [dept, setDept] = useState("all")
  const [query, setQuery] = useState("")
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const hide = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(hide)
  }, [toast])

  // The pills are the departments that actually have doctors, A to Z.
  const departments = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; count: number }>()
    for (const d of doctors) {
      const row = seen.get(d.serviceId) ?? { id: d.serviceId, name: d.serviceName, count: 0 }
      row.count++
      seen.set(d.serviceId, row)
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [doctors])

  const q = query.trim().toLowerCase()
  // Doctors a patient can see today first; the sort is stable, so A to Z within each.
  const shown = doctors
    .filter(
      (d) =>
        (dept === "all" || d.serviceId === dept) &&
        (!q || d.name.toLowerCase().includes(q) || d.specialty.toLowerCase().includes(q)),
    )
    .sort((a, b) => Number(b.availability.bookable) - Number(a.availability.bookable))
  const seeing = doctors.filter((d) => d.availability.bookable).length
  const deptName = departments.find((d) => d.id === dept)?.name

  if (doctors.length === 0) {
    return <p className={styles.none}>No doctors are listed yet. Ask at reception for today&apos;s clinics.</p>
  }

  return (
    <>
      <Toast message={toast} tone="error" />
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter by department">
          {[{ id: "all", name: "All", count: doctors.length }, ...departments].map((d) => (
            <button
              key={d.id}
              type="button"
              className={styles.filter}
              aria-pressed={dept === d.id}
              onClick={() => setDept(d.id)}
            >
              {d.name}
              <span className={styles.count}>{d.count}</span>
            </button>
          ))}
        </div>
        <div className={styles.search}>
          <label htmlFor="doctor-search" className={ui.srOnly}>
            Search doctors by name or specialty
          </label>
          <SearchIcon />
          <input
            id="doctor-search"
            type="search"
            placeholder="Search by name or specialty"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <p className={styles.summary} aria-live="polite">
        {shown.length === doctors.length
          ? `${seeing} of ${doctors.length} doctors seeing patients today`
          : `${shown.length} of ${doctors.length} doctors shown`}
      </p>

      {shown.length === 0 ? (
        <div className={styles.none}>
          <p>
            No doctor matches {q ? <>&ldquo;{query.trim()}&rdquo;</> : "that"}
            {dept !== "all" && deptName ? ` in ${deptName}` : ""}.
          </p>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setDept("all")
              setQuery("")
            }}
          >
            Show all doctors
          </button>
        </div>
      ) : (
        <ul className={styles.grid}>
          {shown.map((d) => (
            <DoctorCard key={d.id} doctor={d} seniorAuto={seniorAuto} onError={setToast} />
          ))}
        </ul>
      )}
    </>
  )
}

export function DoctorsSkeleton() {
  return (
    <div role="status">
      <span className={ui.srOnly}>Loading doctors</span>
      <div aria-hidden="true">
        <div className={styles.toolbar}>
          <span className={`${ui.skel} ${styles.skelFilters}`} />
          <span className={`${ui.skel} ${styles.skelSearch}`} />
        </div>
        <ul className={styles.grid}>
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className={styles.card}>
              <div className={styles.top}>
                <span className={`${ui.skel} ${styles.avatar}`} />
                <span className={`${ui.skel} ${styles.skelName}`} />
              </div>
              <span className={`${ui.skel} ${styles.skelFacts}`} />
              <span className={`${ui.skel} ${styles.skelActions}`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
