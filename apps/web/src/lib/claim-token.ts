import type { SupabaseClient } from "@supabase/supabase-js"

import { callWhenAvailable, type RpcResult } from "./rpc-availability"

// DEPENDENCY: claim_offline_token has no matching migration yet (checked up
// to 0038) -- see lib/cash.ts for the same pattern and why. A patient's
// "Add my paper ticket" screen calls this and renders "coming soon" on
// ok:false/available:false rather than a dead button.
export type ClaimedToken = { id: string; code: string; serviceName: string }

export function claimOfflineToken(
  supabase: SupabaseClient,
  args: { tokenNumber: string; phone: string },
): Promise<RpcResult<ClaimedToken>> {
  return callWhenAvailable(supabase, "claim_offline_token", {
    p_token_number: args.tokenNumber,
    p_phone: args.phone,
  })
}
