import { createClient } from "@/lib/supabase/server"
import { ServicesManager } from "./ServicesManager"
import type { ServiceRow } from "../_lib/types"
import { describeSupabaseError } from "../_lib/describe-error"
import styles from "../admin.module.css"

export default async function ServicesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle()
    : { data: null }

  const { data, error } = await supabase
    .from("services")
    .select("id, org_id, code, name, is_open, default_service_secs, no_show_minutes, max_tokens_per_day")
    .order("name")

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.pageTitle}>Services</div>
          <div className={styles.pageSubtitle}>Departments patients take a token for.</div>
        </div>
      </div>
      {error ? (
        <div className={`${styles.banner} ${styles.bannerDanger}`}>{describeSupabaseError(error)}</div>
      ) : (
        <ServicesManager initialServices={(data ?? []) as ServiceRow[]} orgId={profile?.org_id ?? null} />
      )}
    </div>
  )
}
