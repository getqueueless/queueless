"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { useQueueStats } from "../_lib/use-queue-stats"
import type { ServiceRow } from "../_lib/types"
import { ModelCard } from "./ModelCard"
import { ServiceSelect } from "./ServiceSelect"
import { StatTile } from "./StatTile"
import { WaitComparisonChart } from "./WaitComparisonChart"
import styles from "../admin.module.css"

const NO_DATA = "No data yet"

function fmtMinutes(v: number | null): string {
  return v == null ? NO_DATA : `${Math.round(v)}m`
}

function fmtPercent(v: number | null): string {
  return v == null ? NO_DATA : `${Math.round(v * 100)}%`
}

function DashboardHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className={styles.pageHeader}>
      <div>
        <h1 className={styles.pageTitle}>Dashboard</h1>
        <p className={styles.pageSubtitle}>Live queue stats, refreshed automatically.</p>
      </div>
      {children}
    </div>
  )
}

export function DashboardClient({ services }: { services: ServiceRow[] }) {
  const [serviceId, setServiceId] = useState<string | null>(services[0]?.id ?? null)
  const service = useMemo(() => services.find((s) => s.id === serviceId) ?? null, [services, serviceId])
  const { loading, error, stats, chart, chartNote } = useQueueStats(service)

  if (services.length === 0) {
    return (
      <div>
        <DashboardHeader />
        <div className={styles.banner}>
          No services yet. Add one on the{" "}
          <Link href="/admin/services" className={styles.inlineLink}>
            Services
          </Link>{" "}
          page to see live queue stats here.
        </div>
      </div>
    )
  }

  // buildChart only returns a note next to chart rows when /predict failed,
  // and then every "predicted" value is a placeholder 0.
  const predictionDown = chart.length > 0 && chartNote != null
  const note = predictionDown
    ? "Predictions aren't available yet. The prediction service can't be reached, so the chart shows actual wait only."
    : chartNote

  return (
    <div>
      <DashboardHeader>
        <ServiceSelect services={services} value={serviceId} onChange={setServiceId} />
      </DashboardHeader>

      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerDanger}`}>
          {error}
        </div>
      )}

      <div className={styles.statGrid} aria-busy={loading || undefined}>
        <StatTile label="Queue length" value={loading ? "…" : String(stats?.queueLength ?? 0)} />
        <StatTile label="Avg. wait" value={loading ? "…" : fmtMinutes(stats?.avgWaitMinutes ?? null)} muted={stats?.avgWaitMinutes == null && !loading} />
        <StatTile label="Avg. service time" value={loading ? "…" : fmtMinutes(stats?.avgServiceMinutes ?? null)} muted={stats?.avgServiceMinutes == null && !loading} />
        <StatTile label="Tokens / hour" value={loading ? "…" : (stats?.tokensPerHour ?? 0).toFixed(1)} />
        <StatTile label="No-show rate" value={loading ? "…" : fmtPercent(stats?.noShowRate ?? null)} muted={stats?.noShowRate == null && !loading} />
      </div>

      <section className={styles.card} aria-labelledby="wait-chart-title">
        <h2 id="wait-chart-title" className={styles.cardTitle}>
          Peak hours: predicted vs. actual wait
        </h2>
        {/* Mounted up front so a note that arrives later is announced. */}
        <div role="status">{note && <div className={styles.banner}>{note}</div>}</div>
        {chart.length > 0 ? (
          <WaitComparisonChart data={chart} showPredicted={!predictionDown} />
        ) : loading ? (
          <div className={styles.chartPlaceholder} aria-hidden="true" />
        ) : (
          !note && <div className={styles.banner}>No wait-time data for today yet.</div>
        )}
      </section>

      <ModelCard />
    </div>
  )
}
