import { createClient } from "@/lib/supabase/server"
import { getMyProfile } from "@/lib/supabase/get-role"

import styles from "./my.module.css"

// PLACEHOLDER: the real /my (take token, doctor cards, live status, book,
// claim a paper ticket, history, EN/HI) is separate screen-group work --
// this just proves the auth + profile gate above it actually works end to
// end without leaving the route a 404.
export default async function MyHomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const profile = user ? await getMyProfile(supabase, user.id) : null

  return (
    <div className={styles.placeholder}>
      <h1>Welcome{profile?.fullName ? `, ${profile.fullName}` : ""}.</h1>
      <p>You&apos;re signed in and your profile is complete. Take a token, book an appointment, and check your queue status here.</p>
    </div>
  )
}
