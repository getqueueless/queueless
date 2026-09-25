import { createClient } from "@/lib/supabase/server"
import { PrioritySettings } from "./PrioritySettings"
import type { OrganizationRow } from "../_lib/types"
import { describeSupabaseError } from "../_lib/describe-error"
import styles from "../admin.module.css"

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle()
    : { data: null }

  if (!profile?.org_id) {
    return <div className={`${styles.banner} ${styles.bannerDanger}`}>Couldn&apos;t determine your organization.</div>
  }

  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, slug, name, kind, timezone, priority_head_start_minutes")
    .eq("id", profile.org_id)
    .maybeSingle()

  if (error || !org) {
    return <div className={`${styles.banner} ${styles.bannerDanger}`}>{describeSupabaseError(error)}</div>
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.pageTitle}>Priority settings</div>
          <div className={styles.pageSubtitle}>
            Queue priority lanes are fixed by the platform (no <code>priority_rules</code> table exists in the real
            schema) -- the only tunable is how much of a head start priority lanes get.
          </div>
        </div>
      </div>
      <PrioritySettings org={org as OrganizationRow} />
    </div>
  )
}
