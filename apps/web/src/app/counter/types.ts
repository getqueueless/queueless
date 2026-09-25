// Local types for the counter screen, matching the REAL schema in
// supabase/migrations/000{2,3,4}_*.sql -- not apps/web/types/database.types.ts,
// which is a hand-written placeholder for a different, assumed schema (no
// `staff` table; roles live on `profiles.role`; counters<->services is a
// join table; tokens use `lane`/`called_at`/`serving_at`/`finished_at`, not
// `priority`/`done_at`). That file is the DB agent's to regenerate with
// `supabase gen types` once there's a live DB to point at -- left untouched
// here rather than raced.

export type UserRole = "patient" | "staff" | "admin"
export type CounterState = "open" | "paused" | "closed"
export type Lane = "emergency" | "senior" | "pregnant" | "appointment" | "normal"
export type TokenStatus =
  | "pending_payment"
  | "waiting"
  | "called"
  | "serving"
  | "done"
  | "skipped"
  | "no_show"
  | "cancelled"

export type ProfileRow = {
  id: string
  org_id: string | null
  role: UserRole
  full_name: string | null
}

export type CounterRow = {
  id: string
  org_id: string
  name: string
  state: CounterState
}

export type TokenRow = {
  id: string
  org_id: string
  service_id: string
  service_day: string
  number: number
  code: string
  lane: Lane
  status: TokenStatus
  patient_id: string | null
  walk_in_label: string | null
  counter_id: string | null
  recall_count: number
  called_at: string | null
  serving_at: string | null
}

export const ACTIVE_TOKEN_STATUSES: TokenStatus[] = ["called", "serving"]
