"use client"

import { useActionState, useEffect, useRef } from "react"

import { issueToken } from "./actions"
import styles from "./kiosk.module.css"
import { initialIssueTokenState } from "./state"

export type ServiceOption = { id: string; name: string; code: string }

const ERROR_ID = "kiosk-error"

export function KioskForm({ services }: { services: ServiceOption[] }) {
  const [state, formAction, pending] = useActionState(issueToken, initialIssueTokenState)
  const errorRef = useRef<HTMLDivElement>(null)
  const describedBy = state.error ? ERROR_ID : undefined

  useEffect(() => {
    if (state.error) {
      errorRef.current?.focus()
    }
  }, [state])

  return (
    <form action={formAction} className={styles.form} noValidate>
      {state.error && (
        <div
          ref={errorRef}
          id={ERROR_ID}
          role="alert"
          tabIndex={-1}
          className={styles.errorSummary}
        >
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className={styles.errorIcon}>
            <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
            <path d="M10 5.75v5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <circle cx="10" cy="14.1" r="1.1" fill="currentColor" />
          </svg>
          {state.error}
        </div>
      )}

      <fieldset className={styles.serviceGroup} aria-describedby={describedBy}>
        <legend className={styles.label}>Choose a service</legend>
        {/* The code is the big glyph: it is what the printed token starts with. */}
        {services.map((service) => (
          <label key={service.id} className={styles.serviceOption}>
            <input type="radio" name="service_id" value={service.id} required className={styles.radio} />
            <span className={styles.serviceCode} translate="no" aria-hidden="true">
              {service.code}
            </span>
            <span className={styles.serviceName}>{service.name}</span>
          </label>
        ))}
      </fieldset>

      <div className={styles.formRow}>
        <div className={styles.field}>
          <label htmlFor="walk_in_label" className={styles.label}>
            Name to call out
          </label>
          <input
            id="walk_in_label"
            name="walk_in_label"
            type="text"
            maxLength={40}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. Priya S…"
            aria-describedby={describedBy}
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
