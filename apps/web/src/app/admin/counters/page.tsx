import { createClient } from "@/lib/supabase/server"
import { CountersManager } from "./CountersManager"
import type { CounterRow, ServiceRow } from "../_lib/types"
import { describeSupabaseError } from "../_lib/describe-error"
import styles from "../admin.module.css"

export default async function CountersPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle()
    : { data: null }

  const [countersRes, servicesRes, linksRes, staffRes] = await Promise.all([
    supabase.from("counters").select("id, org_id, name, state, staff_id").order("name"),
    supabase.from("services").select("id, org_id, code, name, is_open, default_service_secs, no_show_minutes, max_tokens_per_day").order("name"),
    supabase.from("counter_services").select("counter_id, service_id"),
    supabase.from("profiles").select("id, org_id, role, full_name, phone, created_at").in("role", ["staff", "admin"]),
  ])

  const error = countersRes.error ?? servicesRes.error
  if (error) {
    return <div className={`${styles.banner} ${styles.bannerDanger}`}>{describeSupabaseError(error)}</div>
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Counters</h1>
          <div className={styles.pageSubtitle}>Desks staff serve from, and which services each one handles.</div>
        </div>
      </div>
      <CountersManager
        initialCounters={(countersRes.data ?? []) as CounterRow[]}
        services={(servicesRes.data ?? []) as ServiceRow[]}
        initialLinks={(linksRes.data ?? []) as { counter_id: string; service_id: string }[]}
        staff={(staffRes.data ?? []).map((p) => ({ id: p.id as string, full_name: p.full_name as string | null }))}
        orgId={profile?.org_id ?? null}
      />
    </div>
  )
}
