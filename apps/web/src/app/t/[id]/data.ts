// Types and queries for the public token-status page, typed against the REAL
// schema in supabase/migrations (0003/0004) rather than
// apps/web/types/database.types.ts -- that hand-written file still models the
// spec's ASSUMED schema (priority/done_at/counters.label) and is stale vs.
// what actually landed (lane/lane_rank/priority_at/service_day/finished_at/
// code, no `priority` column). It's shared/owned by the DB agent, so it's
// left alone here rather than raced; see the report for the reconcile note.
//
// The shared client factories (src/lib/supabase/{server,client}.ts) aren't
// parameterized with a Database generic, so queries here are typed locally
// instead of fighting the stale one.

import type { SupabaseClient } from "@supabase/supabase-js"

export type TokenStatus =
  | "waiting"
  | "called"
  | "serving"
  | "done"
  | "skipped"
  | "no_show"
  | "cancelled"

export type TokenRow = {
  id: string
  service_id: string
  service_day: string
  number: number
  code: string
  lane: string
  lane_rank: number
  priority_at: string
  status: TokenStatus
  counter_id: string | null
  created_at: string
  called_at: string | null
  serving_at: string | null
  finished_at: string | null
}

export type ServiceRow = { id: string; name: string; code: string }
export type CounterRow = { id: string; name: string }

const TOKEN_COLUMNS =
  "id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, counter_id, created_at, called_at, serving_at, finished_at"

// Both the server (`await createClient()`) and browser (`createClient()`)
// factories return an unparameterized SupabaseClient, so there's no Database
// generic to type this against without touching the client files -- alias to
// the untyped SupabaseClient itself rather than hand-rolling an `any` shape.
type AnySupabase = SupabaseClient

export async function fetchToken(supabase: AnySupabase, id: string): Promise<TokenRow | null> {
  const { data, error } = await supabase.from("tokens").select(TOKEN_COLUMNS).eq("id", id).maybeSingle()
  if (error || !data) return null
  return data as TokenRow
}

export async function fetchService(supabase: AnySupabase, serviceId: string): Promise<ServiceRow | null> {
  const { data } = await supabase.from("services").select("id, name, code").eq("id", serviceId).maybeSingle()
  return (data as ServiceRow) ?? null
}

export async function fetchCounter(supabase: AnySupabase, counterId: string): Promise<CounterRow | null> {
  const { data } = await supabase.from("counters").select("id, name").eq("id", counterId).maybeSingle()
  return (data as CounterRow) ?? null
}

// Number of still-waiting tokens ordered ahead of this one, matching the
// exact ordering the DB's own `tokens_queue` partial index uses
// (service_id, service_day, lane_rank, priority_at, number). A count-only
// query (head: true) so it never exposes other patients' token rows to an
// unauthenticated visitor -- just a number.
//
// ponytail: no RLS has landed on `tokens` yet (checked supabase/migrations),
// so this works today only because the table is currently wide open to the
// anon key. Once RLS lands, this page needs a policy/view that permits an
// anon count scoped to (service_id, service_day, status='waiting') -- flagged
// in the report.
export async function countTokensAhead(supabase: AnySupabase, token: TokenRow): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from("tokens")
      .select("id", { count: "exact", head: true })
      .eq("service_id", token.service_id)
      .eq("service_day", token.service_day)
      .eq("status", "waiting")
      .or(
        `lane_rank.lt.${token.lane_rank},` +
          `and(lane_rank.eq.${token.lane_rank},priority_at.lt.${token.priority_at}),` +
          `and(lane_rank.eq.${token.lane_rank},priority_at.eq.${token.priority_at},number.lt.${token.number})`,
      )
    if (error) return null
    return count ?? null
  } catch {
    return null
  }
}

export async function countOpenCounters(supabase: AnySupabase, serviceId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("counter_services")
      .select("counter_id, counters!inner(state)", { count: "exact", head: true })
      .eq("service_id", serviceId)
      .eq("counters.state", "open")
    if (error || count == null) return 1
    return Math.max(count, 1)
  } catch {
    return 1
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
