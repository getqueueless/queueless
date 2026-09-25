"use client"

import { useMemo, useState } from "react"

import { useQueueStats } from "../_lib/use-queue-stats"
import type { ServiceRow } from "../_lib/types"
import { ServiceSelect } from "./ServiceSelect"
import { StatTile } from "./StatTile"
import { WaitComparisonChart } from "./WaitComparisonChart"
import styles from "../admin.module.css"

function fmtMinutes(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}m`
}

function fmtPercent(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`
}

export function DashboardClient({ services }: { services: ServiceRow[] }) {
  const [serviceId, setServiceId] = useState<string | null>(services[0]?.id ?? null)
  const service = useMemo(() => services.find((s) => s.id === serviceId) ?? null, [services, serviceId])
  const { loading, error, stats, chart, chartNote } = useQueueStats(service)

  if (services.length === 0) {
    return (
      <div className={styles.banner}>
        No services yet -- add one under <strong>Services</strong> to see live queue stats.
      </div>
    )
  }

  return (
    <div>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.pageTitle}>Dashboard</div>
          <div className={styles.pageSubtitle}>Live queue stats, refreshed automatically.</div>
        </div>
        <ServiceSelect services={services} value={serviceId} onChange={setServiceId} />
      </div>

      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
          {error}
        </div>
      )}

      <div className={styles.statGrid}>
        <StatTile label="Queue length" value={loading ? "…" : String(stats?.queueLength ?? 0)} />
        <StatTile label="Avg. wait" value={loading ? "…" : fmtMinutes(stats?.avgWaitMinutes ?? null)} muted={stats?.avgWaitMinutes == null && !loading} />
        <StatTile label="Avg. service time" value={loading ? "…" : fmtMinutes(stats?.avgServiceMinutes ?? null)} muted={stats?.avgServiceMinutes == null && !loading} />
        <StatTile label="Tokens / hour" value={loading ? "…" : (stats?.tokensPerHour ?? 0).toFixed(1)} />
        <StatTile label="No-show rate" value={loading ? "…" : fmtPercent(stats?.noShowRate ?? null)} muted={stats?.noShowRate == null && !loading} />
      </div>

      <div className={styles.card}>
        <div className={styles.pageSubtitle} style={{ marginBottom: 12 }}>
          Peak hours -- predicted vs. actual wait
        </div>
        {chartNote && (
          <div role="status" className={styles.banner}>
            {chartNote}
          </div>
        )}
        {chart.length > 0 ? (
          <WaitComparisonChart data={chart} />
        ) : (
          !chartNote && <div className={styles.banner}>No data yet for today.</div>
        )}
      </div>
    </div>
  )
}
