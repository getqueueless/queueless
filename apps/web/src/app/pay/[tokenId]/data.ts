// Types and queries for the payment page, typed against the real schema in
// supabase/migrations/0050-0052 (online prepaid bookings). Same untyped-client
// approach as apps/web/src/app/t/[id]/data.ts, for the same reason (the
// shared client factories carry no Database generic).

import type { SupabaseClient } from "@supabase/supabase-js"

export type PayableTokenStatus = "pending_payment" | "waiting" | "cancelled"

export type PayableToken = {
  id: string
  code: string
  status: PayableTokenStatus | string
  fee_inr: number | null
  hold_expires_at: string | null
  doctor_id: string | null
}

export type DoctorRow = { id: string; name: string; specialty: string }

const TOKEN_COLUMNS = "id, code, status, fee_inr, hold_expires_at, doctor_id"

export async function fetchPayableToken(
  supabase: SupabaseClient,
  id: string,
): Promise<PayableToken | null> {
  const { data, error } = await supabase.from("tokens").select(TOKEN_COLUMNS).eq("id", id).maybeSingle()
  if (error || !data) return null
  return data as PayableToken
}

export async function fetchDoctor(supabase: SupabaseClient, doctorId: string): Promise<DoctorRow | null> {
  const { data } = await supabase.from("doctors").select("id, name, specialty").eq("id", doctorId).maybeSingle()
  return (data as DoctorRow) ?? null
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
