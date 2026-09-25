// Local row types for the admin console, matching the REAL schema landed in
// supabase/migrations/000{1..8}*.sql -- NOT the hand-written
// apps/web/types/database.types.ts, which still models the pre-DB-agent
// "ASSUMED SCHEMA" (a `staff` table, a `priority_rules` table, `done_at`,
// no org scoping). That file is a shared cross-cutting type the DB agent
// owns; rather than race it mid-build, the admin pages type their own
// Supabase calls against these instead. Regenerate database.types.ts from
// the real schema and delete this file once that's safe to do without
// racing a concurrent edit.

export type UserRole = "patient" | "staff" | "admin"
export type CounterState = "open" | "paused" | "closed"
export type TokenStatus =
  | "waiting"
  | "called"
  | "serving"
  | "done"
  | "skipped"
  | "no_show"
  | "cancelled"

export type OrganizationRow = {
  id: string
  slug: string
  name: string
  kind: string
  timezone: string
  priority_head_start_minutes: number
}

export type ProfileRow = {
  id: string
  org_id: string | null
  role: UserRole
  full_name: string | null
  phone: string | null
  created_at: string
}

export type ServiceRow = {
  id: string
  org_id: string
  code: string
  name: string
  is_open: boolean
  default_service_secs: number
  no_show_minutes: number
  max_tokens_per_day: number
}

export type CounterRow = {
  id: string
  org_id: string
  name: string
  state: CounterState
  staff_id: string | null
}

export type TokenRow = {
  id: string
  org_id: string
  service_id: string
  service_day: string
  number: number
  code: string
  status: TokenStatus
  counter_id: string | null
  created_at: string
  called_at: string | null
  serving_at: string | null
  finished_at: string | null
}

export type BoardServiceRow = {
  service_id: string
  day: string
  org_id: string
  waiting_count: number
  served_count: number
  no_show_count: number
  last_called_code: string | null
  avg_service_secs: number | null
  updated_at: string
}
