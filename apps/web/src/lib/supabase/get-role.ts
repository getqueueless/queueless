import type { SupabaseClient } from "@supabase/supabase-js"

export type ProfileSummary = {
  role: "patient" | "staff" | "admin"
  orgId: string | null
  fullName: string | null
  profileCompletedAt: string | null
}

// `public.profiles` still has no RLS policy (docs/DECISIONS.md, "Live RLS
// gap, narrowing but not closed"), but Postgres's default grants to
// `anon`/`authenticated` were never revoked either -- verified live
// 2026-09-26 (an unauthenticated request can read any row). That means this
// read actually succeeds for any signed-in caller today; `profile` here is
// null only on a genuine read error (network, missing row), not as a
// standing condition. The RLS gap itself is a real, separate security
// problem (anon can read -- and per DECISIONS.md, write -- every profile
// directly), just not the thing that makes this function return null.
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
