"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { getCashReportByDoctor, getCashReportByStaff, type CashReportByDoctorRow, type CashReportByStaffRow } from "@/lib/cash"
import { downloadCsv } from "../_lib/csv"
import { daysAgoIST } from "../_lib/today"
import styles from "../admin.module.css"

// Online payments: reads public.payments directly (supabase/migrations/0053's
// payments_admin_read RLS policy scopes this to the caller's own org
// automatically, same as every other admin query on this page). The unified
// payments_ledger VIEW (payments + cash_receipts) stays admin-function-only
// (payments_ledger_report) -- it can't safely be made directly selectable
// without cash_receipts' own owner adding a matching policy there too (see
// 0053's migration comment for why: a security_invoker view errors on the
// whole query, not just the ungranted branch). Only captured payments show
// here -- a still-pending or failed order isn't "cash" yet.
type OnlinePaymentRow = {
  id: string
  amount_inr: number
  status: string
  razorpay_payment_id: string | null
  captured_at: string | null
  tokens: { code: string } | { code: string }[] | null
}

function tokenCode(row: OnlinePaymentRow): string {
  const t = row.tokens
  if (!t) return "—"
  return Array.isArray(t) ? (t[0]?.code ?? "—") : t.code
}

const daysAgo = daysAgoIST

export function CashReport() {
  const [from, setFrom] = useState(daysAgo(7))
  const [to, setTo] = useState(daysAgo(0))
  const [byStaff, setByStaff] = useState<CashReportByStaffRow[] | null>(null)
  const [byDoctor, setByDoctor] = useState<CashReportByDoctorRow[] | null>(null)
  const [onlinePayments, setOnlinePayments] = useState<OnlinePaymentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    // A blocked/failed fetch (offline, CORS, DNS) rejects rather than
    // resolving to an RpcResult/{error} -- without this the page was stuck
    // on "Loading…" forever, since Promise.all rejecting uncaught here meant
    // setLoading(false) below never ran.
    try {
      const [staffRes, doctorRes, ledgerRes] = await Promise.all([
        getCashReportByStaff(supabase, { from, to }),
        getCashReportByDoctor(supabase, { from, to }),
        supabase
          .from("payments")
          .select("id, amount_inr, status, razorpay_payment_id, captured_at, tokens(code)")
          .eq("status", "captured")
          .gte("captured_at", from)
          .lt("captured_at", `${to}T23:59:59`)
          .order("captured_at", { ascending: false })
          .limit(50),
      ])

      if (!staffRes.ok) {
        setError("error" in staffRes ? staffRes.error : "Cash reporting isn't deployed yet.")
        setByStaff(null)
      } else {
        setByStaff(staffRes.data)
      }

      if (doctorRes.ok) setByDoctor(doctorRes.data)

      // Any error here just means "nothing to show yet" -- this section never
      // surfaces its own error banner alongside the cash report's real one.
      setOnlinePayments(ledgerRes.error ? null : (ledgerRes.data as unknown as OnlinePaymentRow[]))
    } catch {
      setError("Couldn't load the cash report. Try again.")
      setByStaff(null)
      setByDoctor(null)
      setOnlinePayments(null)
    }

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

      {onlinePayments && (
        <section className={styles.card} aria-labelledby="cash-online-title">
          <div className={styles.pageHeader}>
            <h2 id="cash-online-title" className={styles.cardTitle}>
              Online payments
            </h2>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={onlinePayments.length === 0}
              onClick={() =>
                downloadCsv(
                  `online-payments-${from}-to-${to}.csv`,
                  ["Token", "Amount (INR)", "Reference", "Captured at"],
                  onlinePayments.map((r) => [tokenCode(r), r.amount_inr, r.razorpay_payment_id ?? "", r.captured_at ?? ""]),
                )
              }
            >
              Export CSV
            </button>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Token</th>
                <th scope="col" className={styles.num}>Amount</th>
                <th scope="col">Reference</th>
                <th scope="col">Captured at</th>
              </tr>
            </thead>
            <tbody>
              {onlinePayments.map((r) => (
                <tr key={r.id}>
                  <td>{tokenCode(r)}</td>
                  <td className={styles.num}>₹{r.amount_inr}</td>
                  <td>{r.razorpay_payment_id}</td>
                  <td>{r.captured_at ? new Date(r.captured_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {onlinePayments.length === 0 && (
                <tr>
                  <td colSpan={4} className={styles.emptyCell}>
                    No online payments in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {loading && <p className={styles.hint}>Loading…</p>}
    </div>
  )
}
