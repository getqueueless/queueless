import { AskPanel } from "./AskPanel"
import styles from "../admin.module.css"

export default function AskPage() {
  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Ask your data</h1>
          <p className={styles.pageSubtitle}>Questions are answered by DeepSeek over a fixed set of read-only queries -- see supabase/README.md.</p>
        </div>
      </div>
      <AskPanel />
    </div>
  )
}
