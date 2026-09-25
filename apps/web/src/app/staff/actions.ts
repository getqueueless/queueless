"use server"

import { redirect } from "next/navigation"

import { roleLandingPath, safeNextPath } from "@/lib/auth/redirect"
import { getMyProfile } from "@/lib/supabase/get-role"
import { createClient } from "@/lib/supabase/server"
import { loginSchema, otpRequestSchema, otpVerifySchema } from "@/lib/validation/auth"

export type PasswordState = {
  error: string | null
  fieldErrors: Partial<Record<"email" | "password", string>>
}

export type OtpRequestState = {
  error: string | null
  sentTo: string | null
}

export type OtpVerifyState = {
  error: string | null
  fieldErrors: Partial<Record<"code", string>>
}

export async function loginWithPassword(
  _prevState: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    const fieldErrors: PasswordState["fieldErrors"] = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (key === "email" || key === "password") fieldErrors[key] = issue.message
    }
    return { error: "Fix the highlighted fields and try again.", fieldErrors }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error || !data.user) {
    return { error: "Incorrect email or password.", fieldErrors: {} }
  }

  const profile = await getMyProfile(supabase, data.user.id)
  const next = safeNextPath(formData.get("next"), roleLandingPath(profile, "password"))
  redirect(next)
}

// Step 1 of patient sign-in: email a 6-digit code (supabase/README.md,
// "Patient auth: email OTP"). `shouldCreateUser: true` doubles as sign-up --
// there is no separate patient registration flow.
export async function requestOtp(
  _prevState: OtpRequestState,
  formData: FormData,
): Promise<OtpRequestState> {
  const parsed = otpRequestSchema.safeParse({ email: formData.get("email") })
  if (!parsed.success) {
    return { error: "Enter a valid email address.", sentTo: null }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true },
  })

  if (error) {
    return { error: "Couldn't send the code. Try again in a moment.", sentTo: null }
  }

  return { error: null, sentTo: parsed.data.email }
}

export async function verifyOtp(
  _prevState: OtpVerifyState,
  formData: FormData,
): Promise<OtpVerifyState> {
  const parsed = otpVerifySchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
  })

  if (!parsed.success) {
    return { error: null, fieldErrors: { code: "Enter the 6-digit code" } }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "email",
  })

  if (error || !data.user) {
    return { error: "That code is wrong or has expired. Request a new one.", fieldErrors: {} }
  }

  const profile = await getMyProfile(supabase, data.user.id)
  const next = safeNextPath(formData.get("next"), roleLandingPath(profile))
  redirect(next)
}
