import { z } from "zod"

// One card, everyone: a patient who's set a password signs in the same way
// as staff/admin (see docs/JUDGE_NOTES.md/QA#8).
export const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
})

export type LoginInput = z.infer<typeof loginSchema>

export const otpRequestSchema = z.object({
  email: z.email("Enter a valid email address"),
})

export type OtpRequestInput = z.infer<typeof otpRequestSchema>

// 0037_mandatory_profile.sql's `token` param to verifyOtp is the 6-digit
// code from the email subject line, not a magic-link token. The same shape
// verifies a sign-in code, a signup confirmation code and a password-reset
// code -- only the `type` passed to supabase.auth.verifyOtp differs.
export const otpVerifySchema = z.object({
  email: z.email("Enter a valid email address"),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
})

export type OtpVerifyInput = z.infer<typeof otpVerifySchema>

export const signUpSchema = z
  .object({
    email: z.email("Enter a valid email address"),
    password: z.string().min(8, "Use at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })

export type SignUpInput = z.infer<typeof signUpSchema>

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })

export type NewPasswordInput = z.infer<typeof newPasswordSchema>

// Mirrors complete_my_profile's own server-side checks (0037) so the form
// fails the same way before it ever calls the RPC -- the RPC re-validates
// regardless, this is just so the user doesn't wait on a round trip to be
// told what a bit of client-side arithmetic already knows.
const INDIA_MOBILE = /^[6-9]\d{9}$/

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^91/, "")
  return `+91${digits}`
}

export const profileSchema = z
  .object({
    fullName: z.string().trim().min(1, "Name is required").max(120),
    phone: z
      .string()
      .transform((v) => v.replace(/\D/g, "").replace(/^91/, ""))
      .pipe(z.string().regex(INDIA_MOBILE, "Enter a 10-digit Indian mobile number")),
    dateOfBirth: z
      .string()
      .refine((v) => {
        const d = new Date(v)
        if (Number.isNaN(d.getTime())) return false
        const now = new Date()
        const min = new Date(now)
        min.setFullYear(min.getFullYear() - 120)
        return d < now && d > min
      }, "Enter a valid date of birth"),
    gender: z.enum(["female", "male", "other", "prefer_not"]),
    city: z.string().trim().min(1, "City is required").max(120),
    addressLine: z.string().trim().max(300).optional().or(z.literal("")),
  })
  .transform((v) => ({ ...v, phone: normalizePhone(v.phone) }))

export type ProfileInput = z.infer<typeof profileSchema>
