"use client"

import { useRouter } from "next/navigation"
import { useRef, useState, useTransition, type FormEvent } from "react"

import styles from "../page.module.css"
import { extractTokenId } from "./token-id"

export function StatusLookup() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const id = extractTokenId(String(new FormData(event.currentTarget).get("token") ?? ""))
    if (!id) {
      setError("That isn't a token link. Paste the whole link from your slip, or the long ID at the end of it.")
      inputRef.current?.focus()
      return
    }
    setError(null)
    startTransition(() => router.push(`/t/${id}`))
  }

  return (
    <form onSubmit={onSubmit} noValidate className={styles.lookup}>
      <label htmlFor="status-token" className={styles.fieldLabel}>
        Token link or ID
      </label>
      <div className={styles.lookupRow}>
        <input
          ref={inputRef}
          id="status-token"
          name="token"
          type="text"
          required
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://…/t/…"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "status-hint status-error" : "status-hint"}
          className={styles.input}
        />
        <button type="submit" disabled={pending} className={`${styles.btn} ${styles.btnAccent}`}>
          {pending ? "Opening…" : "Track my token"}
        </button>
      </div>
      <p id="status-hint" className={styles.hint}>
        It&apos;s printed under the QR code on your slip.
      </p>
      {error && (
        <p id="status-error" role="alert" className={styles.fieldError}>
          {error}
        </p>
      )}
    </form>
  )
}
