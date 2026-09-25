import type { ProfileSummary } from "@/lib/supabase/get-role"

// Only ever redirect to a same-origin relative path -- `next` comes from the
// URL or a form field, so it's untrusted. `fallback` is the safe default.
export function safeNextPath(value: string | FormDataEntryValue | null | undefined, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback
  }
  return value
}

// Patient-first: lpu.lol's default landing for anyone we can't confirm a
// role for is /my, not the staff console. `methodHint` is the one exception
// -- the password tab is staff/admin-only (patients have no password), so a
// successful password sign-in lands on /counter even while the profiles-read
// gap (see get-role.ts) makes `profile` come back null. Once that gap is
// fixed this argument stops mattering: a real profile.role always wins.
export function roleLandingPath(
  profile: ProfileSummary | null,
  methodHint?: "password",
): string {
  if (profile?.role === "admin") return "/admin"
  if (profile?.role === "staff") return "/counter"
  if (profile?.role === "patient") return "/my"
  return methodHint === "password" ? "/counter" : "/my"
}
