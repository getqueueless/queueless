import type { SupabaseClient } from "@supabase/supabase-js"

import { callWhenAvailable, type RpcResult } from "./rpc-availability"

// DEPENDENCY: none of these RPCs exist under supabase/migrations yet as of
// this commit (checked against every file up to 0038) -- documented in the
// task brief but not shipped. Every call here goes through
// callWhenAvailable() so /kiosk and /admin's cash screens render "coming
// soon" instead of crashing, and start working for real the moment the DB
// side lands them; nothing in the screens or here needs to change.

export type WalkInPatient = {
  name: string
  phone: string | null
  age: number | null
  dateOfBirth: string | null
  gender: string | null
  city: string | null
}

export type WalkInToken = {
  id: string
  code: string
  number: number
}

// Mints a walk-in ticket AND records the cash receipt for it in one call --
// the spec's "Cash received ₹<fee> -> staff_register_walkin". If/when this
// lands, confirm its actual param names against the migration before
// wiring the form; these are the names the task brief uses.
export function registerCashWalkIn(
  supabase: SupabaseClient,
  args: { serviceId: string; doctorId: string; patient: WalkInPatient; feeInr: number },
): Promise<RpcResult<WalkInToken>> {
  return callWhenAvailable(supabase, "staff_register_walkin", {
    p_service: args.serviceId,
    p_doctor: args.doctorId,
    p_name: args.patient.name,
    p_phone: args.patient.phone,
    p_date_of_birth: args.patient.dateOfBirth,
    p_gender: args.patient.gender,
    p_city: args.patient.city,
    p_fee_inr: args.feeInr,
  })
}

export type CashReportRow = {
  staffId: string
  staffName: string
  doctorId: string | null
  doctorName: string | null
  receiptCount: number
  totalInr: number
}

export function getCashReport(
  supabase: SupabaseClient,
  args: { startDay: string; endDay: string },
): Promise<RpcResult<CashReportRow[]>> {
  return callWhenAvailable(supabase, "cash_report", {
    p_start_day: args.startDay,
    p_end_day: args.endDay,
  })
}
