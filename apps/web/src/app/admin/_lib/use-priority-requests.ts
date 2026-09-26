"use client"

import { useCallback, useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { useServiceBroadcasts } from "@/lib/realtime/useResilientChannel"
import { describeSupabaseError } from "./describe-error"
import type { ServiceRow } from "./types"

export type Lane = "emergency" | "senior" | "pregnant" | "appointment" | "normal"

export type PriorityRequestRow = {
  id: string
  code: string
  service_id: string
  walk_in_label: string | null
  requested_lane: Lane
  requested_lane_note: string | null
}

const COLUMNS = "id, code, service_id, walk_in_label, requested_lane, requested_lane_note"

// Org-wide, not scoped to one desk: admin sees every waiting priority request
// across every service, same verify_priority/reject_priority RPCs the
// counter desk uses (0072/0074) -- staff-or-admin only, RLS/grants enforce
// that server-side regardless of who calls it.
export function usePriorityRequests(services: ServiceRow[]) {
  const [supabase] = useState(() => createClient())
  const [rows, setRows] = useState<PriorityRequestRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const serviceIds = services.map((s) => s.id)
  const key = serviceIds.slice().sort().join(",")

  const refresh = useCallback(async () => {
    if (!key) return
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })
    const { data, error: err } = await supabase
      .from("tokens")
      .select(COLUMNS)
      .in("service_id", key.split(","))
      .eq("service_day", today)
      .eq("status", "waiting")
      .not("requested_lane", "is", null)
      .order("priority_at", { ascending: true })
    if (err) {
      setError(describeSupabaseError(err))
      return
    }
    setRows((data ?? []) as PriorityRequestRow[])
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable dep; supabase client never changes.
  }, [key])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount, see react.dev/learn/you-might-not-need-an-effect#fetching-data
    refresh()
  }, [refresh])

  useServiceBroadcasts(serviceIds, refresh)

  const verify = useCallback(
    async (row: PriorityRequestRow) => {
      setBusyId(row.id)
      const { error: err } = await supabase.rpc("verify_priority", { p_token: row.id, p_status: row.requested_lane })
      setBusyId(null)
      if (err) {
        setError(describeSupabaseError(err))
        return
      }
      await refresh()
    },
    [supabase, refresh],
  )

  const reject = useCallback(
    async (row: PriorityRequestRow) => {
      setBusyId(row.id)
      const { error: err } = await supabase.rpc("reject_priority", { p_token: row.id })
      setBusyId(null)
      if (err) {
        setError(describeSupabaseError(err))
        return
      }
      await refresh()
    },
    [supabase, refresh],
  )

  return { rows, error, busyId, verify, reject }
}
