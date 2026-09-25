"use client"

import { useActionState, useEffect, useRef, useState } from "react"

import { registerCashWalkin } from "./actions"
import styles from "./kiosk.module.css"

export type DoctorOption = { id: string; name: string; specialty: string; serviceId: string; feeInr: number }

const ERROR_ID = "cash-walkin-error"
const INITIAL_STATE = { error: null }

export function CashWalkinForm({ doctors }: { doctors: DoctorOption[] }) {
  const [state, formAction, pending] = useActionState(registerCashWalkin, INITIAL_STATE)
  const errorRef = useRef<HTMLDivElement>(null)
  const [doctorId, setDoctorId] = useState<string>(doctors[0]?.id ?? "")
  const describedBy = state.error ? ERROR_ID : undefined
  const selected = doctors.find((d) => d.id === doctorId) ?? null

  useEffect(() => {
    if (state.error) errorRef.current?.focus()
  }, [state])

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.error && (
        <div ref={errorRef} id={ERROR_ID} role="alert" tabIndex={-1} className={styles.errorSummary}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className={styles.errorIcon}>
            <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
            <path d="M10 5.75v5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <circle cx="10" cy="14.1" r="1.1" fill="currentColor" />
          </svg>
          {state.error}
        </div>
      )}

      <input type="hidden" name="doctor_id" value={selected?.id ?? ""} />
      <input type="hidden" name="service_id" value={selected?.serviceId ?? ""} />

      <div className={styles.formRow}>
        <div className={styles.field}>
          <label htmlFor="full_name" className={styles.label}>
            Patient name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            maxLength={120}
            required
            autoComplete="off"
            placeholder="e.g. Priya Sharma"
            aria-describedby={describedBy}
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="phone" className={styles.label}>
            Mobile number
          </label>
          <div className={styles.phoneRow}>
            <span className={styles.phonePrefix} aria-hidden="true">
              +91
            </span>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="numeric"
              maxLength={13}
              required
              autoComplete="off"
              placeholder="9876543210"
              aria-describedby={describedBy}
              className={styles.input}
            />
          </div>
        </div>
      </div>

      <fieldset className={styles.serviceGroup} aria-describedby={describedBy}>
        <legend className={styles.label}>Choose a doctor</legend>
        {doctors.map((doctor) => (
          <label key={doctor.id} className={styles.serviceOption}>
            <input
              type="radio"
              name="doctor_radio"
              value={doctor.id}
              checked={doctorId === doctor.id}
              onChange={() => setDoctorId(doctor.id)}
              required
              className={styles.radio}
            />
            <span className={styles.serviceName}>{doctor.name}</span>
            <span className={styles.serviceCode} aria-hidden="true">
              ₹{doctor.feeInr}
            </span>
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={pending || !selected} className={styles.submit}>
        {pending ? "Issuing…" : selected ? `Take ₹${selected.feeInr} cash & issue` : "Pick a doctor"}
      </button>
    </form>
  )
}
