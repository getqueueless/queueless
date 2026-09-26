"use client"

import { usePriorityRequests, type Lane, type PriorityRequestRow } from "../_lib/use-priority-requests"
import type { ServiceRow } from "../_lib/types"
import styles from "../admin.module.css"

const LANE_LABELS: Partial<Record<Lane, string>> = {
  emergency: "Emergency",
  senior: "Senior citizen",
  pregnant: "Pregnant",
}

function Row({
  row,
  serviceName,
  busy,
  onVerify,
  onReject,
}: {
  row: PriorityRequestRow
  serviceName: string
  busy: boolean
  onVerify: () => void
  onReject: () => void
}) {
  return (
    <li className={styles.priorityRow}>
      <div className={styles.priorityRowMain}>
        <span className={styles.priorityBadge} data-lane={row.requested_lane}>
          {LANE_LABELS[row.requested_lane] ?? row.requested_lane}
        </span>
        <span translate="no" className={styles.priorityCode}>
          {row.code}
        </span>
        <span className={styles.priorityMeta}>
          {row.walk_in_label ?? "Registered patient"} · {serviceName}
        </span>
      </div>
      {row.requested_lane_note && <p className={styles.priorityNote}>{row.requested_lane_note}</p>}
      <div className={styles.priorityActions}>
        <button type="button" className={styles.priorityVerify} onClick={onVerify} disabled={busy}>
          {busy ? "Verifying…" : "Verify"}
        </button>
        <button type="button" className={styles.priorityReject} onClick={onReject} disabled={busy}>
          Reject
        </button>
      </div>
    </li>
  )
}

// Org-wide priority queue: every service's waiting tokens with an unverified
// requested_lane (pregnant/emergency; senior auto-verifies at booking, see
// 0072), so admin can approve from one place instead of opening each desk.
// Same verify_priority/reject_priority RPCs the counter console uses.
export function PriorityRequests({ services }: { services: ServiceRow[] }) {
  const { rows, error, busyId, verify, reject } = usePriorityRequests(services)
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "Unknown service"

  if (rows.length === 0 && !error) return null

  return (
    <section className={styles.card} aria-labelledby="priority-requests-title">
      <h2 id="priority-requests-title" className={styles.cardTitle}>
        Priority requests{rows.length > 0 ? ` (${rows.length})` : ""}
      </h2>
      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
          {error}
        </div>
      )}
      {rows.length > 0 && (
        <ul className={styles.priorityList}>
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              serviceName={serviceName(row.service_id)}
              busy={busyId === row.id}
              onVerify={() => void verify(row)}
              onReject={() => void reject(row)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
