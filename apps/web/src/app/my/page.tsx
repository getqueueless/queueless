import { createClient } from "@/lib/supabase/server"
import { getMyProfile } from "@/lib/supabase/get-role"

import { Dashboard } from "./_components/Dashboard"
import { loadOrg } from "./_components/data"

export default async function MyHomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const profile = user ? await getMyProfile(supabase, user.id) : null
  const org = await loadOrg(supabase, profile?.orgId ?? null)

  return (
    <Dashboard
      supabase={supabase}
      userId={user?.id ?? null}
      fullName={profile?.fullName ?? null}
      org={org}
      now={new Date()}
    />
  )
}
