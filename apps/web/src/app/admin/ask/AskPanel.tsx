"use client"

import { useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { apiFetch } from "../_lib/api-fetch"
import type { AskResult } from "../_lib/types"
import styles from "../admin.module.css"

const EXAMPLES_EN = ["No-shows by service today", "Average wait by hour today", "Busiest counters today", "Tokens per day this week"]
const EXAMPLES_HI = ["आज सेवा अनुसार नो-शो", "आज घंटे अनुसार औसत प्रतीक्षा", "आज सबसे व्यस्त काउंटर", "इस सप्ताह प्रति दिन टोकन"]

// analytics.* rows have no fixed shape (8 different function signatures --
// see supabase/README.md) -- this picks the first string-ish key as the
// category axis and every numeric key as its own bar, whatever the function
// returned, instead of hard-coding one chart per function.
function chartFromRows(rows: Record<string, unknown>[]): { categoryKey: string; numericKeys: string[]; data: Record<string, unknown>[] } | null {
  if (rows.length === 0) return null
  const keys = Object.keys(rows[0])
  const numericKeys = keys.filter((k) => typeof rows[0][k] === "number")
  const categoryKey = keys.find((k) => !numericKeys.includes(k))
  if (!categoryKey || numericKeys.length === 0) return null
  return { categoryKey, numericKeys, data: rows }
}

const BAR_COLORS = ["var(--chart-actual)", "var(--chart-predicted)", "var(--color-warning)"]

export function AskPanel() {
  const [lang, setLang] = useState<"en" | "hi">("en")
  const [question, setQuestion] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AskResult | null>(null)

  async function ask(q: string) {
    if (!q.trim() || busy) return
    setBusy(true)
    setError(null)
    setResult(null)
    const res = await apiFetch<AskResult>("/admin/ask", { method: "POST", body: JSON.stringify({ question: q }) })
    if (!res.ok) {
      setError(res.message)
    } else {
      setResult(res.data)
    }
    setBusy(false)
  }

  const chart = result?.rows ? chartFromRows(result.rows) : null

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Ask your data</div>
      <p className={styles.hint}>Ask a question in English or Hindi about today&apos;s queue activity.</p>

      <div className={styles.buttonRow} role="radiogroup" aria-label="Question language">
        <button type="button" role="radio" aria-checked={lang === "en"} className={lang === "en" ? styles.buttonPrimary : styles.buttonSecondary} onClick={() => setLang("en")}>
          English
        </button>
        <button type="button" role="radio" aria-checked={lang === "hi"} className={lang === "hi" ? styles.buttonPrimary : styles.buttonSecondary} onClick={() => setLang("hi")}>
          हिन्दी
        </button>
      </div>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          ask(question)
        }}
      >
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ask-question">
            Question
          </label>
          <input
            id="ask-question"
            className={styles.input}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={lang === "en" ? "e.g. no-shows by service today" : "उदाहरण: आज सेवा अनुसार नो-शो"}
          />
        </div>
        <div className={styles.chipRow}>
          {(lang === "en" ? EXAMPLES_EN : EXAMPLES_HI).map((ex) => (
            <button
              key={ex}
              type="button"
              className={styles.chip}
              onClick={() => {
                setQuestion(ex)
                ask(ex)
              }}
            >
              {ex}
            </button>
          ))}
        </div>
        <div className={styles.buttonRow}>
          <button type="submit" className={styles.buttonPrimary} disabled={busy || !question.trim()}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>

      {error && <div className={`${styles.banner} ${styles.bannerDanger}`}>{error}</div>}

      {result && (
        <div className={styles.stack}>
          <div className={`${styles.badge} ${styles.badgeMuted}`}>{result.ai_generated ? "AI-generated" : "answer"}</div>
          <p>{result.answer}</p>
          {chart && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chart.data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-hairline)" />
                <XAxis dataKey={chart.categoryKey} stroke="var(--color-hairline-strong)" tick={{ fill: "var(--color-ink-muted)" }} tickLine={false} fontSize={12} />
                <YAxis stroke="var(--color-hairline-strong)" tick={{ fill: "var(--color-ink-muted)" }} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-hairline)", borderRadius: 8, fontSize: 13 }}
                  labelStyle={{ color: "var(--color-ink)", fontWeight: 600 }}
                />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                {chart.numericKeys.map((key, i) => (
                  <Bar key={key} dataKey={key} fill={BAR_COLORS[i % BAR_COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={48} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
          {!chart && result.rows && result.rows.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  {Object.keys(result.rows[0]).map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {Object.values(row).map((v, j) => (
                      <td key={j}>{String(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
