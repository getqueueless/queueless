"use server"

import { redirect } from "next/navigation"

import { roleLandingPath, safeNextPath } from "@/lib/auth/redirect"
import { getMyProfile } from "@/lib/supabase/get-role"
import { createClient } from "@/lib/supabase/server"
import {
  loginSchema,
  newPasswordSchema,
  otpRequestSchema,
  otpVerifySchema,
  signUpSchema,
} from "@/lib/validation/auth"

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

export type SignUpState = {
  error: string | null
  fieldErrors: Partial<Record<"email" | "password" | "confirmPassword", string>>
  sentTo: string | null
}

export type NewPasswordState = {
  error: string | null
  fieldErrors: Partial<Record<"password" | "confirmPassword", string>>
}

export type PasswordResetVerifyState = {
  error: string | null
  fieldErrors: Partial<Record<"code", string>>
  verified: boolean
}

export async function signInWithPassword(
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
  const next = safeNextPath(formData.get("next"), roleLandingPath(profile))
  redirect(next)
}

// "Email me a sign-in code instead" -- an existing-account shortcut (GitHub's
// passkey-link equivalent), not the signup path, so this never creates an
// account (see signUp below for that).
export async function requestSignInCode(
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
    options: { shouldCreateUser: false },
  })

  if (error) {
    return { error: "Couldn't send the code. Try again in a moment.", sentTo: null }
  }

  return { error: null, sentTo: parsed.data.email }
}

export async function verifySignInCode(
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

// "New to WaitWise? Create an account" -- signUp() re-runs
// handle_new_user() (0002_organizations_profiles.sql), which inserts the
// 'patient' profile row; this account is unconfirmed until verifySignUp
// below succeeds.
export async function signUp(_prevState: SignUpState, formData: FormData): Promise<SignUpState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  })

  if (!parsed.success) {
    const fieldErrors: SignUpState["fieldErrors"] = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (key === "email" || key === "password" || key === "confirmPassword") fieldErrors[key] = issue.message
    }
    return { error: "Fix the highlighted fields and try again.", fieldErrors, sentTo: null }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    // GoTrue's own message for a taken email is already caller-safe ("User
    // already registered") -- unlike a raw Postgres/config error, this is
    // useful validation feedback, so it's shown as-is.
    return { error: error.message, fieldErrors: {}, sentTo: null }
  }

  // An already-registered, already-confirmed email comes back as a
  // "success" with no new identity (Supabase never confirms account
  // existence to an unauthenticated caller) -- data.user.identities is empty
  // in that case, and there's no code worth waiting for.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return {
      error: "That email already has an account. Try signing in, or use “Forgot password?”.",
      fieldErrors: {},
      sentTo: null,
    }
  }

  return { error: null, fieldErrors: {}, sentTo: parsed.data.email }
}

export async function verifySignUp(
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
    type: "signup",
  })

  if (error || !data.user) {
    return { error: "That code is wrong or has expired. Request a new one.", fieldErrors: {} }
  }

  // A brand-new account has no profile yet worth landing on a role for --
  // roleLandingPath falls through to /my, and proxy.ts's mandatory-profile
  // gate (scoped to role === "patient") takes it from there.
  const profile = await getMyProfile(supabase, data.user.id)
  const next = safeNextPath(formData.get("next"), roleLandingPath(profile))
  redirect(next)
}

export async function requestPasswordReset(
  _prevState: OtpRequestState,
  formData: FormData,
): Promise<OtpRequestState> {
  const parsed = otpRequestSchema.safeParse({ email: formData.get("email") })
  if (!parsed.success) {
    return { error: "Enter a valid email address.", sentTo: null }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email)

  if (error) {
    return { error: "Couldn't send the code. Try again in a moment.", sentTo: null }
  }

  return { error: null, sentTo: parsed.data.email }
}

export async function verifyPasswordReset(
  _prevState: PasswordResetVerifyState,
  formData: FormData,
): Promise<PasswordResetVerifyState> {
  const parsed = otpVerifySchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
  })

  if (!parsed.success) {
    return { error: null, fieldErrors: { code: "Enter the 6-digit code" }, verified: false }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "recovery",
  })

  if (error || !data.user) {
    return { error: "That code is wrong or has expired. Request a new one.", fieldErrors: {}, verified: false }
  }

  // verifyOtp(type: "recovery") already signs the caller in with a recovery
  // session -- setNewPassword below reuses it, no redirect here yet.
  return { error: null, fieldErrors: {}, verified: true }
}

// Last step of "forgot password": the caller already holds the recovery
// session verifyPasswordReset established above.
export async function setNewPassword(
  _prevState: NewPasswordState,
  formData: FormData,
): Promise<NewPasswordState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  })

  if (!parsed.success) {
    const fieldErrors: NewPasswordState["fieldErrors"] = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (key === "password" || key === "confirmPassword") fieldErrors[key] = issue.message
    }
    return { error: "Fix the highlighted fields and try again.", fieldErrors }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: "That reset code has expired. Start over.", fieldErrors: {} }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return { error: "Couldn't set that password. Try again.", fieldErrors: {} }
  }

  const profile = await getMyProfile(supabase, user.id)
  const next = safeNextPath(formData.get("next"), roleLandingPath(profile))
  redirect(next)
}
