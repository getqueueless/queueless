"use client"

import { useActionState, useEffect, useRef } from "react"

import { issueToken } from "./actions"
import styles from "./kiosk.module.css"
import { initialIssueTokenState } from "./state"

export type ServiceOption = { id: string; name: string; code: string }

export function KioskForm({ services }: { services: ServiceOption[] }) {
  const [state, formAction, pending] = useActionState(issueToken, initialIssueTokenState)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.error) {
      errorRef.current?.focus()
    }
  }, [state])

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.error && (
        <div ref={errorRef} role="alert" tabIndex={-1} className={styles.errorSummary}>
          {state.error}
        </div>
      )}

      <fieldset className={styles.serviceGroup}>
        <legend className={styles.label}>Select a service</legend>
        {services.map((service, i) => (
          <label key={service.id} className={styles.serviceOption}>
            <input type="radio" name="service_id" value={service.id} required className={styles.radio} />
            <span className={styles.serviceIndex} aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className={styles.serviceName}>{service.name}</span>
            <span className={styles.serviceCode}>{service.code}</span>
          </label>
        ))}
      </fieldset>

      <div className={styles.formRow}>
        <div className={styles.field}>
          <label htmlFor="walk_in_label" className={styles.label}>
            Name (for calling out)
          </label>
          <input
            id="walk_in_label"
            name="walk_in_label"
            type="text"
            maxLength={40}
            required
            autoComplete="off"
            placeholder="e.g. Priya S."
            className={styles.input}
          />
        </div>

        <button type="submit" disabled={pending} className={styles.submit}>
          {pending ? "Issuing…" : "Get token"}
        </button>
      </div>
    </form>
  )
}
