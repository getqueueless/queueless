import styles from "./states.module.css";

export default function Loading() {
  return (
    <div className={styles.page} role="status" aria-live="polite" aria-busy="true">
      <span className={styles.srOnly}>Loading…</span>
      <div className={styles.bar} aria-hidden="true">
        <span className={styles.block} style={{ width: 140, height: 26 }} />
        <span className={styles.block} style={{ width: 88, height: 36 }} />
      </div>
      <div className={`${styles.hero} ${styles.block}`} aria-hidden="true" />
      <div className={styles.card} aria-hidden="true">
        <span className={`${styles.block} ${styles.line}`} />
        <span className={`${styles.block} ${styles.line}`} />
        <span className={`${styles.block} ${styles.line}`} />
        <span className={`${styles.block} ${styles.btnBlock}`} />
      </div>
    </div>
  );
}
