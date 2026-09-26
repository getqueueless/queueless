"use client"

import { useRef, useState, type ReactNode } from "react"
import { errorInfo } from "@queueless/db"

import h from "./History.module.css"
import { CloseIcon } from "./icons"
import q from "./QuickActions.module.css"

// Cancel RPC codes worth their own words; anything else falls back to errorInfo.
const CANCEL_ERRORS: Record<string, string> = {
  rate_limited: "Too many tries, wait a bit.",
  illegal_transition: "This can't be cancelled any more.",
}

/** cancel_hold (0070): one call for an appointment or a token hold. */
export async function cancelHold(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }> },
  id: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("cancel_hold", { p_id: id })
  // not_found here means the hold already lapsed, was paid, or was released.
  if (error?.code === "not_found") return "This hold has already ended. Refresh to see where it stands."
  return cancelErrorText(error)
}

export const HOLD_OUTCOME = "Nothing was charged for this hold, so there is nothing to refund. The slot goes back to other patients."

/**
 * Words for a failed booking or cancel, never empty: our own copy for codes we
 * know, the server's message for any other private.fail code (they are written
 * for patients), and a plain fallback for raw database or network errors.
 */
export function actionErrorText(
  error: { code?: string; message?: string } | null,
  own: Record<string, string>,
  fallback: string,
): string {
  const code = error?.code ?? ""
  if (own[code]) return own[code]
  const known = errorInfo(code)
  if (known.http !== 500) return known.message
  return /^[a-z_]+$/.test(code) && error?.message ? error.message : fallback
}

export const CANCEL_FALLBACK = "Couldn't cancel right now. Try again in a few minutes."

export function cancelErrorText(error: { code?: string; message?: string } | null): string | null {
  return error ? actionErrorText(error, CANCEL_ERRORS, CANCEL_FALLBACK) : null
}

/**
 * A visible Cancel button that first opens a native modal saying exactly what
 * happens to the money, then runs `run`. `run` resolves to an error message
 * or null; on success the dialog closes and `onDone` fires (toast + refresh).
 */
export function CancelButton({
  label = "Cancel",
  title,
  outcome,
  confirmLabel,
  run,
  onDone,
}: {
  label?: string
  title: string
  outcome: ReactNode
  confirmLabel: string
  run: () => Promise<string | null>
  onDone: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    let message: string | null
    try {
      message = await run()
    } catch {
      message = CANCEL_FALLBACK
    }
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    ref.current?.close()
    onDone()
  }

  return (
    <>
      <button
        type="button"
        className={h.quiet}
        aria-haspopup="dialog"
        onClick={() => {
          setError(null)
          ref.current?.showModal()
        }}
      >
        {label}
      </button>
      <dialog
        ref={ref}
        className={q.dialog}
        aria-label={title}
        onClick={(e) => {
          if (e.target === e.currentTarget && !busy) ref.current?.close()
        }}
      >
        <div className={q.sheet}>
          <div className={q.sheetHead}>
            <h2 className={q.sheetTitle}>{title}</h2>
            <button type="button" className={q.close} onClick={() => ref.current?.close()} aria-label="Close" disabled={busy}>
              <CloseIcon />
            </button>
          </div>
          <div className={q.sheetText}>{outcome}</div>
          {error && (
            <p role="alert" className={h.error}>
              {error}
            </p>
          )}
          <div className={h.dialogActions}>
            <button type="button" className={h.quiet} onClick={() => ref.current?.close()} disabled={busy}>
              Keep it
            </button>
            <button type="button" className={h.danger} onClick={confirm} disabled={busy}>
              {busy ? "Cancelling…" : confirmLabel}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}

/** A short confirmation at the foot of the screen after a cancel. */
export function Toast({ message, tone }: { message: string | null; tone?: "error" }) {
  return (
    <p className={h.toast} role={tone === "error" ? "alert" : "status"} data-show={message ? "" : undefined} data-tone={tone}>
      {message}
    </p>
  )
}
