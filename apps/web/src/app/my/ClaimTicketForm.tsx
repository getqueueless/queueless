"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { errorInfo } from "@queueless/db"

import { createClient } from "@/lib/supabase/client"
import { claimOfflineToken } from "@/lib/claim-token"
import styles from "./my.module.css"

export function ClaimTicketForm() {
  const [supabase] = useState(() => createClient())
  const [code, setCode] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const result = await claimOfflineToken(supabase, { tokenCode: code.trim() })

    if (!result.ok) {
      setError("available" in result ? "Server updating, retry shortly" : errorInfo(result.error).message)
      setPending(false)
      return
    }
    if (!result.data.token) {
      setError(errorInfo(result.data.errorCode ?? "claim_failed").message)
      setPending(false)
      return
    }
    router.push(`/t/${result.data.token.id}`)
  }

  return (
    <form onSubmit={handleSubmit} className={styles.claimForm}>
      <label htmlFor="claim-code" className={styles.claimLabel}>Ticket code</label>
      <div className={styles.claimRow}>
        <input
          id="claim-code"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. OPD-014"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          className={styles.claimInput}
        />
        <button type="submit" disabled={pending || !code.trim()} className={styles.claimSubmit}>
          {pending ? "Checking…" : "Claim"}
        </button>
      </div>
      {error && <p role="alert" className={styles.claimError}>{error}</p>}
    </form>
  )
}
