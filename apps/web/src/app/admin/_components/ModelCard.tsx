"use client"

import { useEffect, useState } from "react"

import { apiFetch } from "../_lib/api-fetch"
import { StatTile } from "./StatTile"
import styles from "../admin.module.css"

// Shape of GET /admin/model (apps/api/app/routes/admin.py's
// _MODEL_REPORT_FIELDS) -- the wait-time prediction model's own report card,
// written by the same retrain job "Retrain now" on this page kicks off.
type ModelReport = {
  version: number | null
  trained_at: string | null
  trained_on: number | null
  mae_model: number | null
  mae_baseline: number | null
  split_method: string | null
  n_rows: number | null
  mae_model_by_service: Record<string, number> | null
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

function fmtMinutes(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}m`
}

export function ModelCard() {
  const [report, setReport] = useState<ModelReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await apiFetch<ModelReport>("/admin/model")
      if (cancelled) return
      if (!res.ok) {
        setError(res.message)
        return
      }
      setReport(res.data)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <section className={styles.card} aria-labelledby="model-card-title">
        <h2 id="model-card-title" className={styles.cardTitle}>
          Wait-time model
        </h2>
        <div className={styles.banner}>{error}</div>
      </section>
    )
  }

  if (!report) {
    return (
      <section className={styles.card} aria-labelledby="model-card-title">
        <h2 id="model-card-title" className={styles.cardTitle}>
          Wait-time model
        </h2>
        <div className={styles.chartPlaceholder} aria-hidden="true" />
      </section>
    )
  }

  const improvement =
    report.mae_model != null && report.mae_baseline != null && report.mae_baseline > 0
      ? Math.round(((report.mae_baseline - report.mae_model) / report.mae_baseline) * 100)
      : null

  return (
    <section className={styles.card} aria-labelledby="model-card-title">
      <h2 id="model-card-title" className={styles.cardTitle}>
        Wait-time model
      </h2>
      <div className={styles.statGrid}>
        <StatTile label="Model error (MAE)" value={fmtMinutes(report.mae_model)} />
        <StatTile label="Naive baseline (MAE)" value={fmtMinutes(report.mae_baseline)} />
        <StatTile label="Improvement" value={improvement == null ? "—" : `${improvement}%`} />
        <StatTile label="Trained on" value={`${report.n_rows ?? "—"} rows`} />
      </div>
      <p className={styles.hint}>
        Version {report.version ?? "—"} · trained {fmtDate(report.trained_at)}
        {report.split_method ? ` · ${report.split_method} split` : ""}
      </p>
    </section>
  )
}
