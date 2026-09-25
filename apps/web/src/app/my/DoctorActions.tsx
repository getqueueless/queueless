"use client"

import { useEffect, useState } from "react"
import { errorInfo } from "@queueless/db"

import { createClient } from "@/lib/supabase/client"
import { BookAndPayButton } from "../pay/BookAndPayButton"
import styles from "./my.module.css"

type DoctorRow = {
  id: string
  service_id: string
  name: string
  specialty: string
  fee_inr: number
}

type Slot = { id: string; starts_at: string; capacity: number; booked: number }

function formatSlot(startsAt: string): string {
  const d = new Date(startsAt)
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function DoctorCard({ doctor }: { doctor: DoctorRow }) {
  const [supabase] = useState(() => createClient())
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [pendingSlot, setPendingSlot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [booked, setBooked] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from("appointment_slots")
      .select("id, starts_at, capacity, booked")
      .eq("doctor_id", doctor.id)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(5)
      .then(({ data }) => {
        if (!cancelled) setSlots((data as Slot[] | null) ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [supabase, doctor.id])

  async function handleBook(slotId: string) {
    setError(null)
    setPendingSlot(slotId)
    const { error: rpcError } = await supabase.rpc("book_appointment", { p_slot: slotId })
    setPendingSlot(null)
    if (rpcError) {
      setError(errorInfo(rpcError.code || rpcError.message).message)
      return
    }
    setBooked(true)
  }

  return (
    <li className={styles.doctorCard}>
      <div>
        <p className={styles.doctorCardName} translate="no">{doctor.name}</p>
        <p className={styles.doctorCardMeta}>{doctor.specialty} · ₹{doctor.fee_inr}</p>
      </div>
      <BookAndPayButton doctorId={doctor.id} className={styles.claimSubmit}>Take a token</BookAndPayButton>
      {slots === null ? null : slots.length === 0 ? (
        <p className={styles.empty}>No upcoming slots.</p>
      ) : booked ? (
        <p className={styles.line}>Appointment booked.</p>
      ) : (
        <ul className={styles.slotList}>
          {slots.filter((s) => s.booked < s.capacity).map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={styles.slotButton}
                disabled={pendingSlot === s.id}
                onClick={() => handleBook(s.id)}
              >
                {pendingSlot === s.id ? "Booking…" : formatSlot(s.starts_at)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className={styles.claimError}>{error}</p>}
    </li>
  )
}

export function DoctorActions({ doctors }: { doctors: DoctorRow[] }) {
  if (doctors.length === 0) return null
  return (
    <section className={styles.section} aria-labelledby="doctors-heading">
      <h2 id="doctors-heading" className={styles.sectionTitle}>Take a token / book appointment</h2>
      <ul className={styles.doctorList}>
        {doctors.map((d) => (
          <DoctorCard key={d.id} doctor={d} />
        ))}
      </ul>
    </section>
  )
}
