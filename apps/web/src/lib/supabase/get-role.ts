import type { SupabaseClient } from "@supabase/supabase-js"

export type ProfileSummary = {
  role: "patient" | "staff" | "admin"
  orgId: string | null
  fullName: string | null
  profileCompletedAt: string | null
}

// DEPENDENCY: `public.profiles` has no RLS policy and no grant to `anon`/
// `authenticated` yet (checked against every migration up to 0038 -- the
// only grants on it are narrow column grants to the separate `queueless_api`
// Postgres role, for apps/api's own direct DB connection, which has nothing
// to do with this app's REST/RPC calls). A signed-in patient/staff/admin's
// own JWT currently gets a permission error reading their own row here.
// `private.my_role()`/`private.is_admin_of()` (0029) exist but live in the
// `private` schema, never exposed over PostgREST -- there is no public RPC
// wrapper for "my own profile" to call instead. Until that grant lands,
// every call here returns null and every caller below fails closed/open per
// its own documented policy -- see proxy.ts and lib/auth/redirect.ts for
// what null means in each context. Logged as the live blocker in
// docs/DECISIONS.md; nothing else in this file needs to change once it's
// fixed, this same query starts returning real rows.
export async function getMyProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProfileSummary | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role, org_id, full_name, profile_completed_at")
      .eq("id", userId)
      .maybeSingle()

    if (error || !data) return null

    return {
      role: data.role as ProfileSummary["role"],
      orgId: data.org_id as string | null,
      fullName: data.full_name as string | null,
      profileCompletedAt: data.profile_completed_at as string | null,
    }
  } catch {
    return null
  }
}
