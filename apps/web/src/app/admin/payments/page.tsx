import { PaymentsManager } from "./PaymentsManager"
import styles from "../admin.module.css"

export default function PaymentsPage() {
  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Payments</h1>
          <p className={styles.pageSubtitle}>Online bookings -- refund a captured payment, or review the automatic doctor-leave refund log.</p>
        </div>
      </div>
      <PaymentsManager />
    </div>
  )
}
