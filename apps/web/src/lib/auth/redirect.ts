import type { ProfileSummary } from "@/lib/supabase/get-role"

// Only ever redirect to a same-origin relative path -- `next` comes from the
// URL or a form field, so it's untrusted. `fallback` is the safe default.
export function safeNextPath(value: string | FormDataEntryValue | null | undefined, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f]/.test(value)) {
    return fallback
  }
  return value
}

// Patient-first: lpu.lol's default landing for anyone we can't confirm a
// role for is /my, not the staff console. Password is no longer a
// staff/admin-only method (/login is one unified card for every role), so
// there's no method-based hint left to fall back on -- only a real
// profile.role picks anything but /my.
export function roleLandingPath(profile: ProfileSummary | null): string {
  if (profile?.role === "admin") return "/admin"
  if (profile?.role === "staff") return "/counter"
  if (profile?.role === "doctor") return "/doctor"
  return "/my"
}
