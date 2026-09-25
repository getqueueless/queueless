import { createClient } from "@/lib/supabase/server"
import { DoctorsManager } from "./DoctorsManager"
import type { DoctorRow, DoctorStatusTodayRow, ServiceRow } from "../_lib/types"
import { describeSupabaseError } from "../_lib/describe-error"
import styles from "../admin.module.css"

export default async function DoctorsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle()
    : { data: null }

  const [doctors, statuses, services] = await Promise.all([
    supabase.from("doctors").select("id, org_id, service_id, name, specialty, qualification, room, photo_url, fee_inr, active, created_at").order("name"),
    supabase.from("doctor_status_today").select("doctor_id, org_id, status, late_minutes"),
    supabase.from("services").select("id, org_id, code, name, is_open, default_service_secs, no_show_minutes, max_tokens_per_day").order("name"),
  ])

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Doctors</h1>
          <p className={styles.pageSubtitle}>Doctors, their weekly shifts, breaks, leaves and today&apos;s status.</p>
        </div>
      </div>
      {doctors.error ? (
        <div className={`${styles.banner} ${styles.bannerDanger}`}>{describeSupabaseError(doctors.error)}</div>
      ) : (
        <DoctorsManager
          initialDoctors={(doctors.data ?? []) as DoctorRow[]}
          initialStatuses={(statuses.data ?? []) as DoctorStatusTodayRow[]}
          services={(services.data ?? []) as ServiceRow[]}
          orgId={profile?.org_id ?? null}
        />
      )}
    </div>
  )
}
