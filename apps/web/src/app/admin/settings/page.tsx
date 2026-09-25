import { createClient } from "@/lib/supabase/server"
import { PrioritySettings } from "./PrioritySettings"
import type { OrganizationRow } from "../_lib/types"
import { describeSupabaseError } from "../_lib/describe-error"
import styles from "../admin.module.css"

// Lanes come from the `lane` enum; there is no priority_rules table, so the
// head start below is the only tunable (see PrioritySettings).
export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle()
    : { data: null }

  const { data: org, error } = profile?.org_id
    ? await supabase
        .from("organizations")
        .select("id, slug, name, kind, timezone, priority_head_start_minutes")
        .eq("id", profile.org_id)
        .maybeSingle()
    : { data: null, error: null }

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Priority settings</h1>
          <p className={styles.pageSubtitle}>
            Priority lanes are fixed by the platform. The one thing you can tune is how much of a head start they get.
          </p>
        </div>
      </div>
      {!profile?.org_id ? (
        <div className={`${styles.banner} ${styles.bannerDanger}`}>
          Your account isn&apos;t linked to an organization, so there are no settings to show.
        </div>
      ) : error || !org ? (
        <div className={`${styles.banner} ${styles.bannerDanger}`}>{describeSupabaseError(error)}</div>
      ) : (
        <PrioritySettings org={org as OrganizationRow} />
      )}
    </div>
  )
}
