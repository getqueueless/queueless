import type { SupabaseClient } from "@supabase/supabase-js"

import type { TokenRow, TokenStatus } from "@/app/t/[id]/data"

// The signed-in patient's live token, shared by the /my token card and the
// ActiveTokenBar. Plain functions, safe on the server and in the browser.

export const ACTIVE_STATUSES: TokenStatus[] = ["pending_payment", "waiting", "called", "serving"]

export type RequestedLane = "senior" | "pregnant" | "emergency" | null
export type LiveToken = { token: TokenRow; ahead: number | null; requestedLane?: RequestedLane }

// tokens has RLS since 0047: a patient sees only their own rows, so counting
// the line with a direct query would always say nobody is ahead.
// get_token_status (0048) counts server-side. It is RETURNS TABLE, so the
// response is an array: .single() unwraps it.
export async function readTokenStatus(supabase: SupabaseClient, id: string): Promise<LiveToken | null> {
  const { data, error } = await supabase.rpc("get_token_status", { p_id: id }).single()
  if (error || !data) return null
  const { people_ahead, ...token } = data as TokenRow & { people_ahead: number | null }
  return { token, ahead: token.status === "waiting" ? people_ahead : null }
}

/** The newest active token of whoever is signed in, or null. */
export async function loadLiveToken(supabase: SupabaseClient): Promise<LiveToken | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from("tokens")
    .select("id, requested_lane")
    .eq("patient_id", user.id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const row = data as { id: string; requested_lane: RequestedLane }
  const live = await readTokenStatus(supabase, row.id)
  return live && { ...live, requestedLane: row.requested_lane }
}

const LANE_NAME = { senior: "Senior citizen", pregnant: "Pregnant", emergency: "Emergency" } as const

/**
 * "Priority requested: Pregnant (awaiting staff check)" until staff move the
 * token into that lane; then "Priority: Pregnant". Senior is automatic.
 * ponytail: a staff rejection clears requested_lane server-side, but the card
 * only learns that on the next page load (get_token_status does not return it).
 */
export function priorityLabel(requested: RequestedLane | undefined, lane: string): string | null {
  if (!requested) return null
  const name = LANE_NAME[requested]
  return lane === requested ? `Priority: ${name}` : `Priority requested: ${name} (awaiting staff check)`
}
