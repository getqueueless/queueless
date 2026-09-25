"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { getCashReportByDoctor, getCashReportByStaff, type CashReportByDoctorRow, type CashReportByStaffRow } from "@/lib/cash"
import { downloadCsv } from "../_lib/csv"
import styles from "../admin.module.css"

// payments_ledger (the online-payments view) doesn't exist in any migration
// yet -- the payments engineer is still building it (see task brief). This
// probes for it with no column assumptions (a raw select("*").limit(50)) so
// this screen neither guesses a schema that isn't documented anywhere nor
// errors while the view is missing -- any failure (missing view or
// otherwise) just keeps the section hidden, same convention as
// callWhenAvailable elsewhere in this codebase.

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function CashReport() {
  const [from, setFrom] = useState(daysAgo(7))
  const [to, setTo] = useState(daysAgo(0))
  const [byStaff, setByStaff] = useState<CashReportByStaffRow[] | null>(null)
  const [byDoctor, setByDoctor] = useState<CashReportByDoctorRow[] | null>(null)
  const [onlinePayments, setOnlinePayments] = useState<Record<string, unknown>[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const [staffRes, doctorRes, ledgerRes] = await Promise.all([
      getCashReportByStaff(supabase, { from, to }),
      getCashReportByDoctor(supabase, { from, to }),
      supabase.from("payments_ledger").select("*").limit(50),
    ])

    if (!staffRes.ok) {
      setError("error" in staffRes ? staffRes.error : "Cash reporting isn't deployed yet.")
      setByStaff(null)
    } else {
      setByStaff(staffRes.data)
    }

    if (doctorRes.ok) setByDoctor(doctorRes.data)

    // Any error here (missing view, or anything else) just means "nothing
    // to show yet" -- this probe never surfaces its own error banner.
    setOnlinePayments(ledgerRes.error ? null : (ledgerRes.data as Record<string, unknown>[]))

    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when the date range changes, see react.dev/learn/you-might-not-need-an-effect#fetching-data
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <div className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="cash-from">From</label>
            <input id="cash-from" type="date" className={styles.input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="cash-to">To</label>
            <input id="cash-to" type="date" className={styles.input} value={to} min={from} max={daysAgo(0)} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <div className={`${styles.banner} ${styles.bannerDanger}`}>{error}</div>}

      {byStaff && (
        <section className={styles.card} aria-labelledby="cash-staff-title">
          <div className={styles.pageHeader}>
            <h2 id="cash-staff-title" className={styles.cardTitle}>
              By staff
            </h2>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={byStaff.length === 0}
              onClick={() =>
                downloadCsv(
                  `cash-by-staff-${from}-to-${to}.csv`,
                  ["Staff", "Receipts", "Total (INR)"],
                  byStaff.map((r) => [r.staff_name, r.receipt_count, r.total_inr]),
                )
              }
            >
              Export CSV
            </button>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Staff</th>
                <th scope="col" className={styles.num}>
                  Receipts
                </th>
                <th scope="col" className={styles.num}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {byStaff.map((r) => (
                <tr key={r.collected_by}>
                  <td>{r.staff_name}</td>
                  <td className={styles.num}>{r.receipt_count}</td>
                  <td className={styles.num}>₹{r.total_inr}</td>
                </tr>
              ))}
              {byStaff.length === 0 && (
                <tr>
                  <td colSpan={3} className={styles.emptyCell}>
                    No cash receipts in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {byDoctor && (
        <section className={styles.card} aria-labelledby="cash-doctor-title">
          <div className={styles.pageHeader}>
            <h2 id="cash-doctor-title" className={styles.cardTitle}>
              By doctor
            </h2>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={byDoctor.length === 0}
              onClick={() =>
                downloadCsv(
                  `cash-by-doctor-${from}-to-${to}.csv`,
                  ["Doctor", "Receipts", "Total (INR)"],
                  byDoctor.map((r) => [r.doctor_name ?? "No doctor", r.receipt_count, r.total_inr]),
                )
              }
            >
              Export CSV
            </button>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Doctor</th>
                <th scope="col" className={styles.num}>
                  Receipts
                </th>
                <th scope="col" className={styles.num}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {byDoctor.map((r) => (
                <tr key={r.doctor_id ?? "none"}>
                  <td>{r.doctor_name ?? <span className={styles.cellMuted}>No doctor</span>}</td>
                  <td className={styles.num}>{r.receipt_count}</td>
                  <td className={styles.num}>₹{r.total_inr}</td>
                </tr>
              ))}
              {byDoctor.length === 0 && (
                <tr>
                  <td colSpan={3} className={styles.emptyCell}>
                    No cash receipts in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* Online payments: only rendered once the payments engineer's
          payments_ledger view actually exists -- see the probe in load()
          above. Raw column dump (same generic-row rendering as the Ask
          panel's fallback table) since this view's real shape isn't
          documented anywhere yet to build a proper report against. */}
      {onlinePayments && onlinePayments.length > 0 && (
        <section className={styles.card} aria-labelledby="cash-online-title">
          <h2 id="cash-online-title" className={styles.cardTitle}>
            Online payments
          </h2>
          <p className={styles.hint}>Raw preview of payments_ledger -- not yet date-filtered or totalled, pending its column contract.</p>
          <table className={styles.table}>
            <thead>
              <tr>
                {Object.keys(onlinePayments[0]).map((k) => (
                  <th key={k} scope="col">
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {onlinePayments.map((row, i) => (
                <tr key={i}>
                  {Object.values(row).map((v, j) => (
                    <td key={j}>{String(v)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {loading && <p className={styles.hint}>Loading…</p>}
    </div>
  )
}
