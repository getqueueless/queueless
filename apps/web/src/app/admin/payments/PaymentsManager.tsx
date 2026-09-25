"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { apiFetch } from "../_lib/api-fetch"
import styles from "../admin.module.css"

// Reads public.payments directly (payments_admin_read RLS policy,
// supabase/migrations/0053, scopes this to the caller's own org). Refunds go
// through apps/api's POST /admin/refunds (require_org_role("admin") there
// too, plus the real Razorpay refund call) -- never a direct DB write from
// here, same split every other write on this console uses.
type PaymentRow = {
  id: string
  amount_inr: number
  status: "created" | "captured" | "failed" | "refunded"
  razorpay_payment_id: string | null
  failure_reason: string | null
  refund_reason: string | null
  initiated_by: string | null
  captured_at: string | null
  refunded_at: string | null
  created_at: string
  tokens: TokenEmbed | TokenEmbed[] | null
}
type TokenEmbed = { code: string; doctors: { name: string } | { name: string }[] | null }

type StatusFilter = "all" | PaymentRow["status"]

function tokenCode(row: PaymentRow): string {
  const t = row.tokens
  const one = Array.isArray(t) ? t[0] : t
  return one?.code ?? "—"
}

function doctorName(row: PaymentRow): string {
  const t = row.tokens
  const one = Array.isArray(t) ? t[0] : t
  const d = one?.doctors
  const doc = Array.isArray(d) ? d[0] : d
  return doc?.name ?? "—"
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function StatusBadge({ status }: { status: PaymentRow["status"] }) {
  const cls =
    status === "captured" ? styles.badgeSuccess : status === "failed" ? styles.badgeWarning : styles.badgeMuted
  return <span className={`${styles.badge} ${cls}`}>{status}</span>
}

export function PaymentsManager() {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(daysAgo(0))
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [rows, setRows] = useState<PaymentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [refundingId, setRefundingId] = useState<string | null>(null)
  const [refundReason, setRefundReason] = useState("")
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refundBusy, setRefundBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    let query = supabase
      .from("payments")
      .select(
        "id, amount_inr, status, razorpay_payment_id, failure_reason, refund_reason, initiated_by, captured_at, refunded_at, created_at, tokens(code, doctors(name))",
      )
      .gte("created_at", from)
      .lt("created_at", `${to}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(200)
    if (statusFilter !== "all") query = query.eq("status", statusFilter)

    // A blocked/failed fetch (offline, CORS, DNS) rejects rather than
    // resolving to { error }, unlike a Postgrest-level error -- without this
    // the table was just silently staying empty with no feedback at all.
    try {
      const { data, error: err } = await query
      if (err) {
        setError(err.message)
        setRows(null)
      } else {
        setRows(data as unknown as PaymentRow[])
      }
    } catch {
      setError("Couldn't load payments. Try again.")
      setRows(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when filters change, see react.dev/learn/you-might-not-need-an-effect#fetching-data
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, statusFilter])

  function startRefund(id: string) {
    setRefundingId(id)
    setRefundReason("")
    setRefundError(null)
  }

  async function confirmRefund(id: string) {
    if (!refundReason.trim()) {
      setRefundError("A reason is required.")
      return
    }
    setRefundBusy(true)
    setRefundError(null)
    const result = await apiFetch<{ status: string; razorpay_refund_id: string }>("/admin/refunds", {
      method: "POST",
      body: JSON.stringify({ payment_id: id, reason: refundReason.trim() }),
    })
    setRefundBusy(false)
    if (!result.ok) {
      setRefundError(result.message)
      return
    }
    setRefundingId(null)
    load()
  }

  const autoRefunds = (rows ?? []).filter((r) => r.status === "refunded" && !r.initiated_by)

  return (
    <div className={styles.stack}>
      <div className={styles.card}>
        <div className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="pay-from">From</label>
            <input id="pay-from" type="date" className={styles.input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="pay-to">To</label>
            <input id="pay-to" type="date" className={styles.input} value={to} min={from} max={daysAgo(0)} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="pay-status">Status</label>
            <select
              id="pay-status"
              className={styles.select}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All</option>
              <option value="created">Created (unpaid)</option>
              <option value="captured">Captured</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className={`${styles.banner} ${styles.bannerDanger}`}>{error}</div>}

      <section className={styles.card} aria-labelledby="payments-title">
        <h2 id="payments-title" className={styles.cardTitle}>Online bookings</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Doctor</th>
              <th scope="col" className={styles.num}>Amount</th>
              <th scope="col">Status</th>
              <th scope="col">Reference</th>
              <th scope="col">When</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td>{tokenCode(r)}</td>
                <td>{doctorName(r)}</td>
                <td className={styles.num}>₹{r.amount_inr}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{r.razorpay_payment_id ?? <span className={styles.cellMuted}>—</span>}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>
                  {r.status === "captured" && refundingId !== r.id && (
                    <button type="button" className={styles.buttonSecondary} onClick={() => startRefund(r.id)}>
                      Refund
                    </button>
                  )}
                  {refundingId === r.id && (
                    <div className={styles.form}>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="Reason"
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                        disabled={refundBusy}
                      />
                      <button type="button" className={styles.buttonDanger} disabled={refundBusy} onClick={() => confirmRefund(r.id)}>
                        {refundBusy ? "Refunding…" : "Confirm"}
                      </button>
                      <button type="button" className={styles.buttonSecondary} disabled={refundBusy} onClick={() => setRefundingId(null)}>
                        Cancel
                      </button>
                      {refundError && <p role="alert" className={styles.claimError}>{refundError}</p>}
                    </div>
                  )}
                  {r.status === "refunded" && (
                    <span className={styles.cellMuted}>{r.initiated_by ? "Refunded (admin)" : "Refunded (auto)"}</span>
                  )}
                  {r.status === "failed" && r.failure_reason && <span className={styles.cellMuted}>{r.failure_reason}</span>}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.emptyCell}>No payments in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && <p className={styles.hint}>Loading…</p>}
      </section>

      <section className={styles.card} aria-labelledby="auto-refunds-title">
        <h2 id="auto-refunds-title" className={styles.cardTitle}>Automatic doctor-leave refunds</h2>
        <p className={styles.hint}>Refunded by the background job the moment a doctor&apos;s leave covered the appointment day -- no admin action taken.</p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Doctor</th>
              <th scope="col" className={styles.num}>Amount</th>
              <th scope="col">Refunded at</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {autoRefunds.map((r) => (
              <tr key={r.id}>
                <td>{tokenCode(r)}</td>
                <td>{doctorName(r)}</td>
                <td className={styles.num}>₹{r.amount_inr}</td>
                <td>{r.refunded_at ? new Date(r.refunded_at).toLocaleString() : "—"}</td>
                <td>{r.refund_reason ?? "—"}</td>
              </tr>
            ))}
            {autoRefunds.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.emptyCell}>No automatic refunds in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
