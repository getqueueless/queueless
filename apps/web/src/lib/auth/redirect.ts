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
// -- the password tab is staff/admin-only (patients have no password, though
// see docs/JUDGE_NOTES.md/QA#8 on that not being enforced), so a successful
// password sign-in falls back to /counter on the rare case `profile` comes
// back null from a genuine read error. A real profile.role always wins.
export function roleLandingPath(
  profile: ProfileSummary | null,
  methodHint?: "password",
): string {
  if (profile?.role === "admin") return "/admin"
  if (profile?.role === "staff") return "/counter"
  if (profile?.role === "patient") return "/my"
  return methodHint === "password" ? "/counter" : "/my"
}
