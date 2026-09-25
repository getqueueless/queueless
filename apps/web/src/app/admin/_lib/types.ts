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

// supabase/migrations/0038_doctors_schedules.sql
export type DoctorStatus = "available" | "running_late" | "on_break" | "off"

export type DoctorRow = {
  id: string
  org_id: string
  service_id: string
  name: string
  specialty: string
  qualification: string | null
  room: string | null
  photo_url: string | null
  fee_inr: number
  active: boolean
  created_at: string
}

export type DoctorScheduleRow = {
  id: string
  doctor_id: string
  weekday: number
  start_time: string
  end_time: string
  max_patients: number
  slot_minutes: number
}

export type DoctorBreakRow = {
  id: string
  doctor_id: string
  weekday: number
  start_time: string
  end_time: string
}

export type DoctorLeaveRow = {
  id: string
  doctor_id: string
  from_date: string
  to_date: string
  reason: string | null
}

// public.doctor_status_today view -- always today, late_minutes only set
// when status = 'running_late'.
export type DoctorStatusTodayRow = {
  doctor_id: string
  org_id: string
  status: DoctorStatus
  late_minutes: number | null
}

// Cash report row types (cash_report_by_staff / cash_report_by_doctor) live
// in @/lib/cash, next to the RPC wrappers that return them -- not
// duplicated here.

// Payments engineer's addition, may not exist yet -- probed for at runtime
// (42P01 "undefined table" means "not shipped", not a real error).
export type PaymentsLedgerRow = {
  collected_by: string | null
  total_inr: number
}

export type AskResult = {
  answer: string
  ai_generated: boolean
  function: string | null
  params: Record<string, unknown> | null
  rows: Record<string, unknown>[] | null
}
