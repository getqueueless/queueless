import { createClient } from "@/lib/supabase/server"
import { getMyProfile } from "@/lib/supabase/get-role"

import { Dashboard } from "./_components/Dashboard"
import { loadOrg } from "./_components/data"

export default async function MyHomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const [profile, dob] = await Promise.all([
    user ? getMyProfile(supabase, user.id) : null,
    user ? supabase.from("profiles").select("date_of_birth").eq("id", user.id).maybeSingle() : null,
  ])
  const org = await loadOrg(supabase, profile?.orgId ?? null)

  return (
    <Dashboard
      supabase={supabase}
      userId={user?.id ?? null}
      fullName={profile?.fullName ?? null}
      dateOfBirth={(dob?.data as { date_of_birth: string | null } | null)?.date_of_birth ?? null}
      org={org}
      now={new Date()}
    />
  )
}
