import { SummaryCard } from "./SummaryCard"
import styles from "../admin.module.css"

export default function SummaryPage() {
  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Daily AI summary</h1>
          <p className={styles.pageSubtitle}>One report per day, generated on demand and cached in ops_summaries.</p>
        </div>
      </div>
      <SummaryCard />
    </div>
  )
}
