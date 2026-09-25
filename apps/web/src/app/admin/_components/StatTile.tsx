import styles from "../admin.module.css"

export function StatTile({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={styles.statTile}>
      <div className={styles.statLabel}>{label}</div>
      <div className={muted ? `${styles.statValue} ${styles.statValueMuted}` : styles.statValue}>{value}</div>
    </div>
  )
}
