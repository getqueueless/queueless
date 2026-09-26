import { createClient } from "@/lib/supabase/server"
import { DemoClockSettings } from "./DemoClockSettings"
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
        .select("id, slug, name, kind, timezone, priority_head_start_minutes, demo_clock_at, demo_clock_set_at")
        .eq("id", profile.org_id)
        .maybeSingle()
    : { data: null, error: null }

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Settings</h1>
          <p className={styles.pageSubtitle}>
            The demo clock for walk-in hours, and how much of a head start priority lanes get.
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
        <div className={styles.stack}>
          <DemoClockSettings org={org as OrganizationRow} />
          <PrioritySettings org={org as OrganizationRow} />
        </div>
      )}
    </div>
  )
}
