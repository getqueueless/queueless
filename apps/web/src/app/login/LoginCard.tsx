"use client"

import { useActionState, useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"

import {
  requestPasswordReset,
  requestSignInCode,
  setNewPassword,
  signInWithPassword,
  signUp,
  verifyPasswordReset,
  verifySignInCode,
  verifySignUp,
} from "./actions"
import {
  initialNewPasswordState,
  initialOtpRequestState,
  initialOtpVerifyState,
  initialPasswordResetVerifyState,
  initialPasswordState,
  initialSignUpState,
} from "./state"
import styles from "./login.module.css"

type View = "signin" | "otp" | "signup" | "forgot"

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

function GoogleButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false)

  async function signInWithGoogle() {
    setPending(true)
    const supabase = createClient()
    const callback = new URL("/auth/callback", window.location.origin)
    if (next) callback.searchParams.set("next", next)
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    })
    // On success the browser navigates away to Google; this only resolves
    // (still on this page) if something failed before the redirect fired.
    setPending(false)
  }

  return (
    <button type="button" className={styles.google} disabled={pending} onClick={() => void signInWithGoogle()}>
      <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
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
  )
}

function SignInView({ next, onSwitch }: { next: string; onSwitch: (view: View) => void }) {
  const [state, formAction, pending] = useActionState(signInWithPassword, initialPasswordState)
  // Controlled, not defaultValue: a Server Action's native form submission
  // clears uncontrolled fields once it completes, which would wipe the
  // email/password on every failed sign-in. Keeping the typed values here
  // instead is what makes an error round-trip without losing them.
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  return (
    <>
      <form action={formAction} className={styles.form} noValidate>
        <input type="hidden" name="next" value={next} />

        {state.error && <ErrorSummary text={state.error} />}

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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
          <div className={styles.labelRow}>
            <label htmlFor="password" className={styles.label}>
              Password
            </label>
            <button type="button" className={styles.linkButton} onClick={() => onSwitch("forgot")}>
              Forgot password?
            </button>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

      <div className={styles.divider} role="separator">
        <span>or</span>
      </div>

      <GoogleButton next={next} />

      <button type="button" className={styles.linkButton} onClick={() => onSwitch("otp")}>
        Email me a sign-in code instead
      </button>

      <div className={styles.signupBox}>
        <p className={styles.prompt}>
          New to Queueless?{" "}
          <button type="button" className={styles.linkButton} onClick={() => onSwitch("signup")}>
            Create an account
          </button>
        </p>
      </div>
    </>
  )
}

function OtpView({ next, onBack }: { next: string; onBack: () => void }) {
  const [step, setStep] = useState<"request" | "verify">("request")
  const [requestState, requestAction, requestPending] = useActionState(requestSignInCode, initialOtpRequestState)
  const [verifyState, verifyAction, verifyPending] = useActionState(verifySignInCode, initialOtpVerifyState)
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- advances the step after the request action's state settles, see react.dev/learn/you-might-not-need-an-effect#fetching-data
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
          <label htmlFor="otp-code" className={styles.label}>
            6-digit code
          </label>
          <input
            id="otp-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={verifyState.fieldErrors.code ? "true" : undefined}
            aria-describedby={verifyState.fieldErrors.code ? "otp-code-error" : undefined}
            className={`${styles.input} ${styles.otpInput}`}
          />
          {verifyState.fieldErrors.code && (
            <p id="otp-code-error" role="alert" className={styles.fieldError}>
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
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={styles.input}
        />
      </div>

      <button type="submit" disabled={requestPending} className={styles.submit}>
        {requestPending ? "Sending…" : "Send code"}
      </button>

      <button type="button" className={styles.linkButton} onClick={onBack}>
        Back to sign in
      </button>
    </form>
  )
}

function SignUpView({ next, onBack }: { next: string; onBack: () => void }) {
  const [step, setStep] = useState<"request" | "verify">("request")
  const [requestState, requestAction, requestPending] = useActionState(signUp, initialSignUpState)
  const [verifyState, verifyAction, verifyPending] = useActionState(verifySignUp, initialOtpVerifyState)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [code, setCode] = useState("")

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- advances the step after the signUp action's state settles, see react.dev/learn/you-might-not-need-an-effect#fetching-data
    if (requestState.sentTo) setStep("verify")
  }, [requestState.sentTo])

  if (step === "verify" && requestState.sentTo) {
    return (
      <form action={verifyAction} className={styles.form} noValidate>
        <input type="hidden" name="email" value={requestState.sentTo} />
        <input type="hidden" name="next" value={next} />

        {verifyState.error && <ErrorSummary text={verifyState.error} />}

        <div role="status" className={styles.statusSummary}>
          We sent a 6-digit code to <strong>{requestState.sentTo}</strong> to confirm your
          account. It&apos;s in the subject line, not the body, and expires in 10 minutes.
        </div>

        <div className={styles.field}>
          <label htmlFor="signup-code" className={styles.label}>
            6-digit code
          </label>
          <input
            id="signup-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={verifyState.fieldErrors.code ? "true" : undefined}
            aria-describedby={verifyState.fieldErrors.code ? "signup-code-error" : undefined}
            className={`${styles.input} ${styles.otpInput}`}
          />
          {verifyState.fieldErrors.code && (
            <p id="signup-code-error" role="alert" className={styles.fieldError}>
              {verifyState.fieldErrors.code}
            </p>
          )}
        </div>

        <button type="submit" disabled={verifyPending} className={styles.submit}>
          {verifyPending ? "Checking…" : "Verify & continue"}
        </button>
      </form>
    )
  }

  return (
    <form action={requestAction} className={styles.form} noValidate>
      {requestState.error && <ErrorSummary text={requestState.error} />}

      <div className={styles.field}>
        <label htmlFor="signup-email" className={styles.label}>
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="username"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={requestState.fieldErrors.email ? "true" : undefined}
          className={styles.input}
        />
        {requestState.fieldErrors.email && <p className={styles.fieldError}>{requestState.fieldErrors.email}</p>}
      </div>

      <div className={styles.field}>
        <label htmlFor="signup-password" className={styles.label}>
          Password
        </label>
        <input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={requestState.fieldErrors.password ? "true" : undefined}
          className={styles.input}
        />
        {requestState.fieldErrors.password && <p className={styles.fieldError}>{requestState.fieldErrors.password}</p>}
      </div>

      <div className={styles.field}>
        <label htmlFor="signup-confirm" className={styles.label}>
          Confirm password
        </label>
        <input
          id="signup-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          aria-invalid={requestState.fieldErrors.confirmPassword ? "true" : undefined}
          className={styles.input}
        />
        {requestState.fieldErrors.confirmPassword && <p className={styles.fieldError}>{requestState.fieldErrors.confirmPassword}</p>}
      </div>

      <button type="submit" disabled={requestPending} className={styles.submit}>
        {requestPending ? "Creating…" : "Create account"}
      </button>

      <button type="button" className={styles.linkButton} onClick={onBack}>
        Back to sign in
      </button>
    </form>
  )
}

function ForgotView({ next, onBack }: { next: string; onBack: () => void }) {
  const [step, setStep] = useState<"request" | "verify" | "newPassword">("request")
  const [requestState, requestAction, requestPending] = useActionState(requestPasswordReset, initialOtpRequestState)
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyPasswordReset, initialPasswordResetVerifyState)
  const [newPasswordState, newPasswordAction, newPasswordPending] = useActionState(setNewPassword, initialNewPasswordState)
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- advances the step after the request action's state settles, see react.dev/learn/you-might-not-need-an-effect#fetching-data
    if (requestState.sentTo) setStep("verify")
  }, [requestState.sentTo])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verifyPasswordReset never redirects (it only signs in with a recovery session), so this effect is what advances to the last step once it succeeds
    if (verifyState.verified) setStep("newPassword")
  }, [verifyState.verified])

  if (step === "newPassword") {
    return (
      <form action={newPasswordAction} className={styles.form} noValidate>
        <input type="hidden" name="next" value={next} />

        {newPasswordState.error && <ErrorSummary text={newPasswordState.error} />}

        <div className={styles.field}>
          <label htmlFor="new-password" className={styles.label}>
            New password
          </label>
          <input
            id="new-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={newPasswordState.fieldErrors.password ? "true" : undefined}
            className={styles.input}
          />
          {newPasswordState.fieldErrors.password && <p className={styles.fieldError}>{newPasswordState.fieldErrors.password}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="new-password-confirm" className={styles.label}>
            Confirm new password
          </label>
          <input
            id="new-password-confirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={newPasswordState.fieldErrors.confirmPassword ? "true" : undefined}
            className={styles.input}
          />
          {newPasswordState.fieldErrors.confirmPassword && (
            <p className={styles.fieldError}>{newPasswordState.fieldErrors.confirmPassword}</p>
          )}
        </div>

        <button type="submit" disabled={newPasswordPending} className={styles.submit}>
          {newPasswordPending ? "Saving…" : "Save password"}
        </button>
      </form>
    )
  }

  if (step === "verify" && requestState.sentTo) {
    return (
      <form action={verifyAction} className={styles.form} noValidate>
        <input type="hidden" name="email" value={requestState.sentTo} />

        {verifyState.error && <ErrorSummary text={verifyState.error} />}

        <div role="status" className={styles.statusSummary}>
          We sent a 6-digit code to <strong>{requestState.sentTo}</strong>. It&apos;s in the
          subject line, not the body, and expires in 10 minutes.
        </div>

        <div className={styles.field}>
          <label htmlFor="reset-code" className={styles.label}>
            6-digit code
          </label>
          <input
            id="reset-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={verifyState.fieldErrors.code ? "true" : undefined}
            className={`${styles.input} ${styles.otpInput}`}
          />
          {verifyState.fieldErrors.code && <p className={styles.fieldError}>{verifyState.fieldErrors.code}</p>}
        </div>

        <button type="submit" disabled={verifyPending} className={styles.submit}>
          {verifyPending ? "Checking…" : "Verify code"}
        </button>
      </form>
    )
  }

  return (
    <form action={requestAction} className={styles.form} noValidate>
      {requestState.error && <ErrorSummary text={requestState.error} />}

      <div className={styles.field}>
        <label htmlFor="reset-email" className={styles.label}>
          Email
        </label>
        <input
          id="reset-email"
          name="email"
          type="email"
          autoComplete="username"
          spellCheck={false}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={styles.input}
        />
      </div>

      <button type="submit" disabled={requestPending} className={styles.submit}>
        {requestPending ? "Sending…" : "Send reset code"}
      </button>

      <button type="button" className={styles.linkButton} onClick={onBack}>
        Back to sign in
      </button>
    </form>
  )
}

export function LoginCard({ next }: { next: string }) {
  const [view, setView] = useState<View>("signin")

  return (
    <div className={styles.body}>
      {view === "signin" && <SignInView next={next} onSwitch={setView} />}
      {view === "otp" && <OtpView next={next} onBack={() => setView("signin")} />}
      {view === "signup" && <SignUpView next={next} onBack={() => setView("signin")} />}
      {view === "forgot" && <ForgotView next={next} onBack={() => setView("signin")} />}
    </div>
  )
}
