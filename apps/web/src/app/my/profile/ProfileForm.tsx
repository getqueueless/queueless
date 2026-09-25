"use client"

import { useActionState, useEffect, useRef } from "react"

import { completeProfile } from "./actions"
import styles from "./profile.module.css"

export type ProfileFormState = {
  error: string | null
  fieldErrors: Partial<
    Record<"fullName" | "phone" | "dateOfBirth" | "gender" | "city" | "addressLine", string>
  >
}

export function ProfileForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(completeProfile, {
    error: null,
    fieldErrors: {},
  })
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.error) errorRef.current?.focus()
  }, [state])

  return (
    <form action={formAction} className={styles.form} noValidate>
      <input type="hidden" name="next" value={next} />

      {state.error && (
        <div ref={errorRef} role="alert" tabIndex={-1} className={styles.errorSummary}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className={styles.errorIcon}>
            <circle cx="10" cy="10" r="8.25" />
            <path d="M10 5.75v5" />
            <circle cx="10" cy="14" r="0.6" />
          </svg>
          <span>{state.error}</span>
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor="fullName" className={styles.label}>
          Full name
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          aria-invalid={state.fieldErrors.fullName ? "true" : undefined}
          aria-describedby={state.fieldErrors.fullName ? "fullName-error" : undefined}
          className={styles.input}
        />
        {state.fieldErrors.fullName && (
          <p id="fullName-error" role="alert" className={styles.fieldError}>
            {state.fieldErrors.fullName}
          </p>
        )}
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
            autoComplete="tel-national"
            placeholder="98765 43210"
            required
            aria-invalid={state.fieldErrors.phone ? "true" : undefined}
            aria-describedby={state.fieldErrors.phone ? "phone-error" : undefined}
            className={styles.input}
          />
        </div>
        {state.fieldErrors.phone && (
          <p id="phone-error" role="alert" className={styles.fieldError}>
            {state.fieldErrors.phone}
          </p>
        )}
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="dateOfBirth" className={styles.label}>
            Date of birth
          </label>
          <input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            required
            aria-invalid={state.fieldErrors.dateOfBirth ? "true" : undefined}
            aria-describedby={state.fieldErrors.dateOfBirth ? "dob-error" : undefined}
            className={styles.input}
          />
          {state.fieldErrors.dateOfBirth && (
            <p id="dob-error" role="alert" className={styles.fieldError}>
              {state.fieldErrors.dateOfBirth}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label htmlFor="gender" className={styles.label}>
            Gender
          </label>
          <select id="gender" name="gender" required defaultValue="" className={styles.select}>
            <option value="" disabled>
              Select
            </option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="prefer_not">Prefer not to say</option>
          </select>
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="city" className={styles.label}>
          City
        </label>
        <input
          id="city"
          name="city"
          type="text"
          autoComplete="address-level2"
          required
          aria-invalid={state.fieldErrors.city ? "true" : undefined}
          aria-describedby={state.fieldErrors.city ? "city-error" : undefined}
          className={styles.input}
        />
        {state.fieldErrors.city && (
          <p id="city-error" role="alert" className={styles.fieldError}>
            {state.fieldErrors.city}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="addressLine" className={styles.label}>
          Address <span className={styles.optional}>(optional)</span>
        </label>
        <textarea
          id="addressLine"
          name="addressLine"
          autoComplete="street-address"
          className={styles.textarea}
        />
      </div>

      <button type="submit" disabled={pending} className={styles.submit}>
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </form>
  )
}
