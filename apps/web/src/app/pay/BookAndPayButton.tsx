"use client"

// Small entry point any doctor/booking screen can embed: tapping it holds
// the spot for 10 minutes (start_paid_booking, supabase/migrations/0052)
// and routes to the payment page. Not wired into a doctor-picker screen
// yet -- that page is owned by another session; this is the piece it can
// import once it exists (see docs/DECISIONS.md).

import { useState } from "react"
import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"

export function BookAndPayButton({
  doctorId,
  className,
  children = "Book & pay",
}: {
  doctorId: string
  className?: string
  children?: React.ReactNode
}) {
  const [supabase] = useState(() => createClient())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleClick() {
    setPending(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc("start_paid_booking", {
      p_doctor_id: doctorId,
    })
    if (rpcError) {
      setError(rpcError.message)
      setPending(false)
      return
    }
    router.push(`/pay/${data.id}`)
  }

  return (
    <div>
      <button type="button" className={className} onClick={handleClick} disabled={pending}>
        {pending ? "Holding your spot…" : children}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
