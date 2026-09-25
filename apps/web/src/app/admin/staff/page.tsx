import { StaffManager } from "./StaffManager"
import styles from "../admin.module.css"

// Data for this page loads client-side from /api/admin/staff (service-role
// backed) rather than a direct Supabase query here, since listing staff and
// creating them go through the same admin-checked route either way.
export default function StaffPage() {
  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.pageTitle}>Staff</div>
          <div className={styles.pageSubtitle}>Counter staff and admins for your organization.</div>
        </div>
      </div>
      <StaffManager />
    </div>
  )
}
