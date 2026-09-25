import { createClient } from "@/lib/supabase/server"
import { DashboardClient } from "./_components/DashboardClient"
import type { ServiceRow } from "./_lib/types"
import { describeSupabaseError } from "./_lib/describe-error"
import styles from "./admin.module.css"

export default async function AdminDashboardPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("services")
    .select("id, org_id, code, name, is_open, default_service_secs, no_show_minutes, max_tokens_per_day")
    .order("name")

  if (error) {
    return (
      <div>
        <div className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>Dashboard</h1>
          </div>
        </div>
        <div className={`${styles.banner} ${styles.bannerDanger}`}>{describeSupabaseError(error)}</div>
      </div>
    )
  }

  return <DashboardClient services={(data ?? []) as ServiceRow[]} />
}
