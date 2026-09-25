import type { SupabaseClient } from "@supabase/supabase-js"

export type RpcResult<T> = { ok: true; data: T } | { ok: false; available: false } | { ok: false; error: string }

// PGRST202: PostgREST couldn't find that function -- the standard shape for
// "this RPC hasn't shipped on origin/main yet" (see @queueless/db's
// errorInfo(), which maps it to "Server updating, retry shortly"). 42883 is
// Postgres's own "function does not exist" if a direct DB error ever leaks
// through instead of PostgREST's wrapped shape. Anything else is a real
// error the caller should show, not swallow as "coming soon".
const NOT_SHIPPED_CODES = new Set(["PGRST202", "42883"])

// Calls an RPC that's documented but may not have a matching migration yet
// (staff_register_walkin, cash_report, claim_offline_token as of this
// commit -- see docs/DECISIONS.md). Screens use `ok:false, available:false`
// to render a "coming soon" state instead of a raw error banner; any other
// failure is a real error to surface normally.
export async function callWhenAvailable<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args)

  if (!error) return { ok: true, data: data as T }
  if (NOT_SHIPPED_CODES.has(error.code ?? "")) return { ok: false, available: false }
  return { ok: false, error: error.message }
}
