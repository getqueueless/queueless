"use client"

import { useActionState, useEffect, useRef } from "react"

import { login } from "./actions"
import { initialLoginState } from "./state"
import styles from "./login.module.css"

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(login, initialLoginState)
  const errorRef = useRef<HTMLDivElement>(null)

  // Move focus to the error summary on every failed submit, so keyboard and
  // screen-reader users land on it without having to hunt for what changed.
  useEffect(() => {
    if (state.error) {
      errorRef.current?.focus()
    }
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
        <label htmlFor="email" className={styles.label}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          spellCheck={false}
          required
          aria-invalid={state.fieldErrors.email ? "true" : undefined}
          aria-describedby={state.fieldErrors.email ? "email-error" : undefined}
          className={styles.input}
        />
        {state.fieldErrors.email && (
          <p id="email-error" role="alert" className={styles.fieldError}>
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div className={styles.field}>
        <label htmlFor="password" className={styles.label}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.fieldErrors.password ? "true" : undefined}
          aria-describedby={state.fieldErrors.password ? "password-error" : undefined}
          className={styles.input}
        />
        {state.fieldErrors.password && (
          <p id="password-error" role="alert" className={styles.fieldError}>
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      <button type="submit" disabled={pending} className={styles.submit}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  )
}
