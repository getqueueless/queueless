"use client"

import { useActionState, useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"

import { loginWithPassword, requestOtp, verifyOtp } from "./actions"
import {
  initialOtpRequestState,
  initialOtpVerifyState,
  initialPasswordState,
} from "./state"
import styles from "./staff.module.css"

type Tab = "google" | "otp" | "password"

function ErrorSummary({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [text])
  return (
    <div ref={ref} role="alert" tabIndex={-1} className={styles.errorSummary}>
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className={styles.errorIcon}>
        <circle cx="10" cy="10" r="8.25" />
        <path d="M10 5.75v5" />
        <circle cx="10" cy="14" r="0.6" />
      </svg>
      <span>{text}</span>
    </div>
  )
}

function GooglePanel({ next }: { next: string }) {
  const [pending, setPending] = useState(false)

  async function signInWithGoogle() {
    setPending(true)
    const supabase = createClient()
    const callback = new URL("/auth/callback", window.location.origin)
    callback.searchParams.set("next", next)
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    })
    // On success the browser navigates away to Google; this only resolves
    // (still on this page) if something failed before the redirect fired.
    setPending(false)
  }

  return (
    <div className={styles.form}>
      <button type="button" className={styles.google} disabled={pending} onClick={signInWithGoogle}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62Z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z"
          />
          <path
            fill="#FBBC05"
            d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03l3.01-2.33Z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
          />
        </svg>
        {pending ? "Redirecting…" : "Continue with Google"}
      </button>
      <p className={styles.hint}>
        Fastest for a phone you already carry. If Google sign-in isn&apos;t available, use the
        email code instead.
      </p>
    </div>
  )
}

function OtpPanel({ next }: { next: string }) {
  const [step, setStep] = useState<"request" | "verify">("request")
  const [requestState, requestAction, requestPending] = useActionState(
    requestOtp,
    initialOtpRequestState,
  )
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyOtp,
    initialOtpVerifyState,
  )

  useEffect(() => {
    if (requestState.sentTo) setStep("verify")
  }, [requestState.sentTo])

  if (step === "verify" && requestState.sentTo) {
    return (
      <form action={verifyAction} className={styles.form} noValidate>
        <input type="hidden" name="email" value={requestState.sentTo} />
        <input type="hidden" name="next" value={next} />

        {verifyState.error && <ErrorSummary text={verifyState.error} />}

        <div role="status" className={styles.statusSummary}>
          We sent a 6-digit code to <strong>{requestState.sentTo}</strong>. It&apos;s in the
          subject line, not the body, and expires in 10 minutes.
        </div>

        <div className={styles.field}>
          <label htmlFor="code" className={styles.label}>
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            aria-invalid={verifyState.fieldErrors.code ? "true" : undefined}
            aria-describedby={verifyState.fieldErrors.code ? "code-error" : undefined}
            className={`${styles.input} ${styles.otpInput}`}
          />
          {verifyState.fieldErrors.code && (
            <p id="code-error" role="alert" className={styles.fieldError}>
              {verifyState.fieldErrors.code}
            </p>
          )}
        </div>

        <button type="submit" disabled={verifyPending} className={styles.submit}>
          {verifyPending ? "Checking…" : "Verify & continue"}
        </button>

        <button type="button" className={styles.linkButton} onClick={() => setStep("request")}>
          Use a different email
        </button>
      </form>
    )
  }

  return (
    <form action={requestAction} className={styles.form} noValidate>
      <input type="hidden" name="next" value={next} />

      {requestState.error && <ErrorSummary text={requestState.error} />}

      <div className={styles.field}>
        <label htmlFor="otp-email" className={styles.label}>
          Email
        </label>
        <input
          id="otp-email"
          name="email"
          type="email"
          autoComplete="email"
          spellCheck={false}
          required
          className={styles.input}
        />
      </div>

      <button type="submit" disabled={requestPending} className={styles.submit}>
        {requestPending ? "Sending…" : "Send code"}
      </button>
    </form>
  )
}

function PasswordPanel({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginWithPassword, initialPasswordState)

  return (
    <form action={formAction} className={styles.form} noValidate>
      <input type="hidden" name="next" value={next} />

      {state.error && <ErrorSummary text={state.error} />}

      <div className={styles.field}>
        <label htmlFor="password-email" className={styles.label}>
          Email
        </label>
        <input
          id="password-email"
          name="email"
          type="email"
          autoComplete="username"
          spellCheck={false}
          required
          aria-invalid={state.fieldErrors.email ? "true" : undefined}
          aria-describedby={state.fieldErrors.email ? "password-email-error" : undefined}
          className={styles.input}
        />
        {state.fieldErrors.email && (
          <p id="password-email-error" role="alert" className={styles.fieldError}>
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

const TABS: { key: Tab; label: string }[] = [
  { key: "google", label: "Google" },
  { key: "otp", label: "Email code" },
  { key: "password", label: "Staff password" },
]

export function LoginTabs({ next, initialTab }: { next: string; initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab)

  return (
    <div>
      <div role="tablist" aria-label="Sign-in method" className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            className={styles.tab}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "google" && <GooglePanel next={next} />}
        {tab === "otp" && <OtpPanel next={next} />}
        {tab === "password" && <PasswordPanel next={next} />}
      </div>
    </div>
  )
}
