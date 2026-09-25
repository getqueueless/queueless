"use client"

import { useActionState, useEffect, useRef, useState } from "react"

import { completeProfile } from "./actions"
import styles from "./profile.module.css"

type ProfileFieldValues = Record<"fullName" | "phone" | "dateOfBirth" | "gender" | "city" | "addressLine", string>

export type ProfileFormState = {
  error: string | null
  fieldErrors: Partial<ProfileFieldValues>
  values: ProfileFieldValues | null
}

export function ProfileForm({
  next,
  initialValues = null,
}: {
  next: string
  // P2 fix: prefills "Edit profile" from the saved row (page.tsx) instead of a blank form --
  // seeded once as the useActionState initial state, so it flows through the exact same
  // state.values -> defaultValue wiring an error-recovery re-render already uses below.
  initialValues?: ProfileFieldValues | null
}) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(completeProfile, {
    error: null,
    fieldErrors: {},
    values: initialValues,
  })
  const errorRef = useRef<HTMLDivElement>(null)
  const v = state.values

  // QA P1: maxLength=10 truncated a country-code-prefixed number (919876543210,
  // +919876543210 -- both forms 0060_phone_normalization.sql's normalize_in_phone
  // accepts server-side) before the user could even finish typing it. Controlled now
  // so a 12/13-char entry that turns out to carry a 91/+91 prefix collapses to the
  // bare 10 digits live, matching what the fixed "+91" span beside it already implies
  // -- the same digit-count-based disambiguation profileSchema's stripCountryCode
  // uses server-side (10 digits starting with 91 is a real number, not a prefix).
  const [phoneValue, setPhoneValue] = useState(v?.phone ?? "")
  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    const digits = raw.replace(/\D/g, "")
    setPhoneValue(digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : raw)
  }

  // QA P2: React resets an uncontrolled <form action={fn}> back to each field's
  // defaultValue once the action settles -- on ANY submit, not just a successful one,
  // since React has no way to know "error" from a plain returned state object. That
  // wiped every field on a validation/RPC error. Fix: echo the submitted values back
  // in `state` (actions.ts) and remount the form with a fresh key each time a
  // submission completes, so the reset lands on the CORRECT (just-submitted)
  // defaultValue instead of the field's original empty one.
  const [formKey, setFormKey] = useState(0)
  const wasPending = useRef(pending)
  useEffect(() => {
    if (wasPending.current && !pending) setFormKey((k) => k + 1)
    wasPending.current = pending
  }, [pending])

  // Depends on formKey too: the remount above happens one render after `state`
  // updates, which would otherwise unmount the very div this just focused and leave
  // the freshly-mounted one (post-remount) never focused.
  useEffect(() => {
    if (state.error) errorRef.current?.focus()
  }, [state, formKey])

  return (
    <form key={formKey} action={formAction} className={styles.form} noValidate>
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
          defaultValue={v?.fullName}
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
            placeholder="9876543210"
            value={phoneValue}
            onChange={handlePhoneChange}
            maxLength={13}
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
            defaultValue={v?.dateOfBirth}
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
          <select id="gender" name="gender" required defaultValue={v?.gender ?? ""} className={styles.select}>
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
          defaultValue={v?.city}
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
          defaultValue={v?.addressLine}
          className={styles.textarea}
        />
      </div>

      <button type="submit" disabled={pending} className={styles.submit}>
        {pending ? "Saving…" : "Save & continue"}
      </button>
    </form>
  )
}
