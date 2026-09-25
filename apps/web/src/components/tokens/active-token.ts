import type { SupabaseClient } from "@supabase/supabase-js"

import type { TokenRow, TokenStatus } from "@/app/t/[id]/data"

// The signed-in patient's live token, shared by the /my token card and the
// ActiveTokenBar. Plain functions, safe on the server and in the browser.

export const ACTIVE_STATUSES: TokenStatus[] = ["pending_payment", "waiting", "called", "serving"]

export type LiveToken = { token: TokenRow; ahead: number | null }

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
    .select("id")
    .eq("patient_id", user.id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? readTokenStatus(supabase, (data as { id: string }).id) : null
}
