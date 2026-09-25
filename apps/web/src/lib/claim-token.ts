import type { SupabaseClient } from "@supabase/supabase-js"

import { callWhenAvailable, type RpcResult } from "./rpc-availability"

// Matches supabase/migrations/0042_claim_offline_token.sql exactly. A
// patient's "Add my paper ticket" screen calls this to link a walk-in
// ticket to their account by code + their own verified phone.
//
// claim_offline_token is the one RPC in the whole schema that does NOT
// raise for its own failure outcomes -- see supabase/README.md's "Offline
// ticket claim" section. PostgREST runs one request as one transaction, and
// raising would roll back the 5/hour lockout's own failed-attempt log along
// with everything else. So: an RpcResult ok:false here means a real
// Postgres-level error (not shipped, not signed in, incomplete profile) --
// a rejected claim (wrong code, already active, rate-limited) comes back
// ok:true with `token: null` and `errorCode` set. Callers must check both.

export type ClaimResult = {
  token: { id: string; code: string; service_id: string; status: string } | null
  errorCode: "claim_failed" | "already_active" | "too_many_attempts" | null
  retryAfter: number | null
}

type ClaimResultRow = { token: ClaimResult["token"]; error_code: ClaimResult["errorCode"]; retry_after: number | null }

export async function claimOfflineToken(supabase: SupabaseClient, args: { tokenCode: string }): Promise<RpcResult<ClaimResult>> {
  const result = await callWhenAvailable<ClaimResultRow>(supabase, "claim_offline_token", { p_token_code: args.tokenCode })
  if (!result.ok) return result
  return { ok: true, data: { token: result.data.token, errorCode: result.data.error_code, retryAfter: result.data.retry_after } }
}
