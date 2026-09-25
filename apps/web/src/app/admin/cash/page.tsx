import { CashReport } from "./CashReport"
import styles from "../admin.module.css"

export default function CashPage() {
  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Cash report</h1>
          <p className={styles.pageSubtitle}>Cash receipts by staff and by doctor over a date range.</p>
        </div>
      </div>
      <CashReport />
    </div>
  )
}
