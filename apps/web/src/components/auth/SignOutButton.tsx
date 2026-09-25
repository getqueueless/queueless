"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { createClient } from "@/lib/supabase/client"

export function SignOutButton({
  className,
  redirectTo = "/staff?tab=password",
  children = "Sign out",
}: {
  className?: string
  redirectTo?: string
  children?: React.ReactNode
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function signOut() {
    setPending(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push(redirectTo)
  }

  return (
    <button type="button" className={className} onClick={() => void signOut()} disabled={pending}>
      {pending ? "Signing out…" : children}
    </button>
  )
}
