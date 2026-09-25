// Types and queries for the payment/checkout page, typed against the real schema in
// supabase/migrations/0050-0057 (online prepaid bookings + paid appointments). Same
// untyped-client approach as apps/web/src/app/t/[id]/data.ts, for the same reason (the shared
// client factories carry no Database generic).

import type { SupabaseClient } from "@supabase/supabase-js"

export type HoldStatus = "pending_payment" | "waiting" | "booked" | "cancelled"

export type PayableHold = {
  id: string
  kind: "token" | "appointment"
  status: HoldStatus | string
  fee_inr: number | null
  hold_expires_at: string | null
  doctor_id: string | null
  code: string | null
  startsAt: string | null
}

export type DoctorRow = { id: string; name: string; specialty: string }
export type PatientProfile = { full_name: string | null; phone: string | null }

const TOKEN_COLUMNS = "id, code, status, fee_inr, hold_expires_at, doctor_id"
const APPOINTMENT_COLUMNS = "id, status, fee_inr, hold_expires_at, doctor_id, appointment_slots(starts_at)"

// A hold is either a walk-in token or a booked appointment (0056's payments_exactly_one_target
// mirrors this at the DB layer) -- id spaces don't overlap, so trying the token table first and
// falling back to appointments is enough to tell which one a bare id refers to.
export async function fetchPayableHold(supabase: SupabaseClient, id: string): Promise<PayableHold | null> {
  const { data: token } = await supabase.from("tokens").select(TOKEN_COLUMNS).eq("id", id).maybeSingle()
  if (token) {
    return {
      id: token.id, kind: "token", status: token.status, fee_inr: token.fee_inr,
      hold_expires_at: token.hold_expires_at, doctor_id: token.doctor_id, code: token.code, startsAt: null,
    }
  }

  const { data: appt } = await supabase.from("appointments").select(APPOINTMENT_COLUMNS).eq("id", id).maybeSingle()
  if (!appt) return null
  const slot = Array.isArray(appt.appointment_slots) ? appt.appointment_slots[0] : appt.appointment_slots
  return {
    id: appt.id, kind: "appointment", status: appt.status, fee_inr: appt.fee_inr,
    hold_expires_at: appt.hold_expires_at, doctor_id: appt.doctor_id, code: null,
    startsAt: (slot as { starts_at: string } | null)?.starts_at ?? null,
  }
}

export async function fetchDoctor(supabase: SupabaseClient, doctorId: string): Promise<DoctorRow | null> {
  const { data } = await supabase.from("doctors").select("id, name, specialty").eq("id", doctorId).maybeSingle()
  return (data as DoctorRow) ?? null
}

export async function fetchPatientProfile(supabase: SupabaseClient, userId: string): Promise<PatientProfile | null> {
  const { data } = await supabase.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle()
  return (data as PatientProfile) ?? null
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
