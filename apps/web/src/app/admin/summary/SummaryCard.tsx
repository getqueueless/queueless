"use client"

import { useEffect, useState } from "react"

import { apiFetch } from "../_lib/api-fetch"
import { todayIST } from "../_lib/today"
import styles from "../admin.module.css"

type SummaryResponse = {
  org_id: string
  day: string
  report: string
  ai_generated: boolean
  aggregates: Record<string, unknown>
}

const today = todayIST

export function SummaryCard() {
  const [day, setDay] = useState(today())
  const [lang, setLang] = useState<"" | "hi" | "pa">("")
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  async function load() {
    setLoadError(null)
    const qs = new URLSearchParams({ day, ...(lang ? { lang } : {}) })
    const res = await apiFetch<SummaryResponse>(`/admin/summary?${qs}`)
    if (!res.ok) {
      setSummary(null)
      setLoadError(res.status === 404 ? "No summary generated for this day yet." : res.message)
      return
    }
    setSummary(res.data)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when day/lang change, see react.dev/learn/you-might-not-need-an-effect#fetching-data
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, lang])

  async function generateNow() {
    setBusy(true)
    setRunError(null)
    const res = await apiFetch<SummaryResponse>("/admin/summary/run", { method: "POST", body: JSON.stringify({ day }) })
    if (!res.ok) {
      setRunError(res.message)
    } else {
      await load()
    }
    setBusy(false)
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Daily AI summary</div>

      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="summary-day">
            Day
          </label>
          <input id="summary-day" type="date" className={styles.input} value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="summary-lang">
            Language
          </label>
          <select id="summary-lang" className={styles.select} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
            <option value="">English</option>
            <option value="hi">हिन्दी</option>
            <option value="pa">ਪੰਜਾਬੀ</option>
          </select>
        </div>
        <div className={styles.buttonRow}>
          <button type="button" className={styles.buttonPrimary} onClick={generateNow} disabled={busy}>
            {busy ? "Generating…" : "Generate now"}
          </button>
        </div>
      </div>

      {runError && <div className={`${styles.banner} ${styles.bannerDanger}`}>{runError}</div>}
      {loadError && <div className={styles.hint}>{loadError}</div>}

      {summary && (
        <div className={styles.stack}>
          <div className={`${styles.badge} ${styles.badgeMuted}`}>{summary.ai_generated ? "AI-generated" : "summary"}</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{summary.report}</p>
        </div>
      )}
    </div>
  )
}
