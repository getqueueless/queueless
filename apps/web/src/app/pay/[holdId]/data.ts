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

// get_payable_hold (0071): the in-app browser's very first render of this page is ANON (the
// mobile handoff's access token lives in the URL fragment, which never reaches the server) --
// anon has no table access to appointments at all, so a direct `.from("appointments")` read
// here always came back null for a slot booking ("Booking not found", the actual P0). This
// SECURITY DEFINER RPC is the fix: the hold's own uuid acts as an unguessable capability (same
// trust model as /t/<id>), returns nothing patient-identifying, and only resolves for a hold
// that's still actually payable.
export async function fetchPayableHold(
  supabase: SupabaseClient,
  id: string,
): Promise<(PayableHold & { doctorName: string | null; specialty: string | null }) | null> {
  const { data } = await supabase.rpc("get_payable_hold", { p_id: id }).maybeSingle()
  if (!data) return null
  type Row = {
    id: string; kind: "token" | "appointment"; status: string; fee_inr: number | null
    hold_expires_at: string | null; doctor_id: string | null; doctor_name: string | null
    specialty: string | null; starts_at: string | null; code: string | null
  }
  const row = data as Row
  return {
    id: row.id, kind: row.kind, status: row.status, fee_inr: row.fee_inr,
    hold_expires_at: row.hold_expires_at, doctor_id: row.doctor_id, code: row.code,
    startsAt: row.starts_at, doctorName: row.doctor_name, specialty: row.specialty,
  }
}

export async function fetchPatientProfile(supabase: SupabaseClient, userId: string): Promise<PatientProfile | null> {
  const { data } = await supabase.from("profiles").select("full_name, phone").eq("id", userId).maybeSingle()
  return (data as PatientProfile) ?? null
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
