import type { SupabaseClient } from "@supabase/supabase-js"

import { callWhenAvailable, type RpcResult } from "./rpc-availability"

// Matches supabase/migrations/0041_cash_desk.sql exactly -- these RPCs are
// real and shipped as of that migration, but callWhenAvailable is kept
// anyway so a screen calling this against an environment that hasn't
// migrated yet still degrades to "coming soon" instead of a raw error.

export type WalkInPatient = {
  fullName: string
  phone: string
  dateOfBirth: string | null
  gender: "female" | "male" | "other" | "prefer_not"
  city: string | null
}

export type WalkInToken = {
  id: string
  code: string
  number: number
  service_id: string
  status: string
}

// Mints a walk-in ticket, and -- only when cashReceived is true -- records
// its cash receipt in the same call (amountOverride falls back to the
// doctor's own fee_inr, then 0, entirely server-side).
export function registerCashWalkIn(
  supabase: SupabaseClient,
  args: {
    serviceId: string
    doctorId: string | null
    patient: WalkInPatient
    lane?: "emergency" | "senior" | "pregnant" | "appointment" | "normal"
    cashReceived?: boolean
    amountOverride?: number | null
  },
): Promise<RpcResult<WalkInToken>> {
  return callWhenAvailable(supabase, "staff_register_walkin", {
    p_full_name: args.patient.fullName,
    p_phone: args.patient.phone,
    p_date_of_birth: args.patient.dateOfBirth,
    p_gender: args.patient.gender,
    p_city: args.patient.city,
    p_service_id: args.serviceId,
    p_doctor_id: args.doctorId,
    p_lane: args.lane ?? "normal",
    p_cash_received: args.cashReceived ?? false,
    p_amount_override: args.amountOverride ?? null,
  })
}

export type CashReportByStaffRow = { collected_by: string; staff_name: string; receipt_count: number; total_inr: number }
export type CashReportByDoctorRow = { doctor_id: string | null; doctor_name: string | null; receipt_count: number; total_inr: number }

// cash_report_by_staff and cash_report_by_doctor are two separate RPCs, not
// one combined "cash_report" -- each groups the same cash_receipts range by
// a different dimension.
export function getCashReportByStaff(supabase: SupabaseClient, args: { from: string; to: string }): Promise<RpcResult<CashReportByStaffRow[]>> {
  return callWhenAvailable(supabase, "cash_report_by_staff", { p_from: args.from, p_to: args.to })
}

export function getCashReportByDoctor(supabase: SupabaseClient, args: { from: string; to: string }): Promise<RpcResult<CashReportByDoctorRow[]>> {
  return callWhenAvailable(supabase, "cash_report_by_doctor", { p_from: args.from, p_to: args.to })
}
