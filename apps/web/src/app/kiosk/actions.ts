"use server"

import { errorInfo } from "@queueless/db"
import { redirect } from "next/navigation"

import { registerCashWalkIn } from "@/lib/cash"
import { createClient } from "@/lib/supabase/server"

export type IssueTokenState = { error: string | null }
export type CashWalkinState = { error: string | null }

// tokens_walk_in_label_len (supabase/migrations/0004_tokens.sql) requires
// 1..40 chars once trimmed.
function cleanLabel(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim().slice(0, 40)
  return trimmed.length > 0 ? trimmed : null
}

export async function issueToken(
  _prevState: IssueTokenState,
  formData: FormData,
): Promise<IssueTokenState> {
  const serviceId = formData.get("service_id")
  const label = cleanLabel(formData.get("walk_in_label"))

  if (typeof serviceId !== "string" || serviceId.length === 0) {
    return { error: "Pick a service first." }
  }
  if (!label) {
    return { error: "Enter a name so staff can call this ticket." }
  }

  const supabase = await createClient()

  // DEPENDENCY: `staff_issue_token(p_service uuid, p_lane lane, p_walk_in_label
  // text, p_patient uuid default null) returns tokens` is documented in
  // supabase/README.md but has no matching file yet under supabase/migrations/
  // -- stubbed per the repo's golden rule (RPCs are the API; never reimplement
  // queue state client-side). This call degrades gracefully: a missing
  // function comes back as Postgres/PostgREST's "PGRST202", which
  // @queueless/db's errorInfo() already maps to "Server updating, retry
  // shortly" instead of a raw error.
  //
  // Picked `staff_issue_token` over the task brief's `issue_token(service_id)`
  // because the real `issue_token` is patient-self-serve only (requires a
  // signed-in patient JWT, mints a ticket for the caller) -- wrong shape for
  // an anonymous walk-in with no patient_id. `staff_issue_token` is the one
  // RPC documented to accept `p_walk_in_label` for exactly this case
  // (tokens_has_holder requires patient_id OR walk_in_label). It also
  // requires a staff-role JWT (`forbidden` otherwise), which is why this
  // page gates on a signed-in session before showing the form at all -- see
  // page.tsx.
  const { data, error } = await supabase.rpc("staff_issue_token", {
    p_service: serviceId,
    p_lane: "normal",
    p_walk_in_label: label,
  })

  if (error) {
    return { error: errorInfo(error.code || error.message).message }
  }

  const token = data as { id?: string; number?: number; code?: string } | null
  if (!token?.id || token.number === undefined || !token.code) {
    return { error: "Something went wrong minting the token." }
  }

  const params = new URLSearchParams({
    issued: token.id,
    number: String(token.number),
    code: token.code,
    service_id: serviceId,
  })
  redirect(`/kiosk?${params.toString()}`)
}

// Cash walk-in mode (QA: no web UI called staff_register_walkin -- lib/cash.ts existed,
// unused). Reuses the same registerCashWalkIn wrapper the admin cash-report screens are
// built against, cash always received (the button says "Take cash & issue" -- there is no
// unpaid path in this form), gender left as "prefer_not" since the form collects no gender
// field, matching what this desk actually asks a walk-in patient for.
function cleanText(raw: FormDataEntryValue | null, max: number): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim().slice(0, max)
  return trimmed.length > 0 ? trimmed : null
}

export async function registerCashWalkin(
  _prevState: CashWalkinState,
  formData: FormData,
): Promise<CashWalkinState> {
  const fullName = cleanText(formData.get("full_name"), 120)
  const phone = cleanText(formData.get("phone"), 20)
  const doctorId = formData.get("doctor_id")
  const serviceId = formData.get("service_id")

  if (!fullName) return { error: "Enter the patient's name." }
  if (!phone) return { error: "Enter a 10-digit mobile number." }
  if (typeof doctorId !== "string" || doctorId.length === 0) return { error: "Pick a doctor first." }
  if (typeof serviceId !== "string" || serviceId.length === 0) return { error: "Pick a doctor first." }

  const supabase = await createClient()
  const result = await registerCashWalkIn(supabase, {
    serviceId,
    doctorId,
    patient: { fullName, phone, dateOfBirth: null, gender: "prefer_not", city: null },
    cashReceived: true,
  })

  if (!result.ok) {
    return { error: "available" in result ? "Server updating, retry shortly" : errorInfo(result.error).message }
  }

  const token = result.data
  const params = new URLSearchParams({
    issued: token.id,
    number: String(token.number),
    code: token.code,
    service_id: token.service_id,
    cash: "1",
  })
  redirect(`/kiosk?${params.toString()}`)
}
