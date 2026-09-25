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

export function cancelErrorText(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null
  const code = error.code ?? ""
  const known = errorInfo(code)
  return CANCEL_ERRORS[code] ?? (known.http !== 500 ? known.message : error.message || known.message)
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
    const message = await run()
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
export function Toast({ message }: { message: string | null }) {
  return (
    <p className={h.toast} role="status" data-show={message ? "" : undefined}>
      {message}
    </p>
  )
}
