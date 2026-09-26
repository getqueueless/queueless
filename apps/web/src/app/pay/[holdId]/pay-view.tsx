"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { LogoMark } from "@/components/brand/Logo"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"
import { createClient } from "@/lib/supabase/client"
import { fetchPatientProfile, type DoctorRow, type PatientProfile, type PayableHold } from "./data"
import styles from "./pay.module.css"

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js"
const CHECKOUT_THEME_COLOR = "#0cb7d6"
const PLATFORM_FEE_INR = 0

type Phase = "idle" | "paying" | "verifying" | "paid" | "failed" | "expired" | "cancelled"

type PaidReceipt = { razorpayPaymentId: string; amountInr: number }

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

// A shared edge rate-limit (10s/IP on several paths) can 429 a request that's otherwise fine --
// one retry after the shortest safe wait clears it without the patient having to do anything.
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init)
  if (res.status !== 429) return res
  await new Promise((r) => setTimeout(r, 1500))
  return fetch(url, init)
}

let razorpayScriptPromise: Promise<void> | null = null

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script")
      script.src = RAZORPAY_SCRIPT_SRC
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        razorpayScriptPromise = null
        reject(new Error("Could not load the payment provider"))
      }
      document.head.appendChild(script)
    })
  }
  return razorpayScriptPromise
}

// A JWT's payload is unsigned base64url JSON -- fine to peek at client-side
// for a prefill hint (never a trust decision), not fine to treat as verified.
function emailFromJwt(token: string): string | undefined {
  try {
    const payload = token.split(".")[1]
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    const claims = JSON.parse(json) as { email?: string }
    return claims.email
  } catch {
    return undefined
  }
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function initials(name: string | null): string {
  if (!name) return "Dr"
  const parts = name.replace(/^Dr\.?\s+/i, "").trim().split(/\s+/)
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
}

// Explicit locale AND explicit timeZone, never the environment default for either -- the
// server's Node locale/timezone and the browser's can disagree, which is a hydration-mismatch
// trap (same fix apps/web/src/app/my/_components/format.ts's slotLabel already uses).
const DISPLAY_TIME_ZONE = "Asia/Kolkata"

function formatWhen(startsAt: string): string {
  const d = new Date(startsAt)
  const date = d.toLocaleDateString("en-US", { timeZone: DISPLAY_TIME_ZONE, weekday: "short", month: "short", day: "numeric" })
  const time = d.toLocaleTimeString("en-US", { timeZone: DISPLAY_TIME_ZONE, hour: "numeric", minute: "2-digit" })
  return `${date} · ${time}`
}

// A .ics download needs no server -- the browser turns a data: blob straight into a file save.
function downloadIcs(hold: PayableHold, doctor: DoctorRow | null) {
  if (!hold.startsAt) return
  const start = new Date(hold.startsAt)
  const end = new Date(start.getTime() + 30 * 60 * 1000)
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Queueless//Booking//EN", "BEGIN:VEVENT",
    `UID:${hold.id}@queueless`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${doctor ? `Appointment with ${doctor.name}` : "Queueless appointment"}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n")
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }))
  const a = document.createElement("a")
  a.href = url
  a.download = "appointment.ics"
  a.click()
  URL.revokeObjectURL(url)
}

export function PayView({
  holdId,
  initialHold,
  doctor,
}: {
  holdId: string
  initialHold: PayableHold
  doctor: DoctorRow | null
}) {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [hold, setHold] = useState(initialHold)
  const [profile, setProfile] = useState<PatientProfile | null>(null)
  const [phase, setPhase] = useState<Phase>(() =>
    initialHold.status === "waiting" || initialHold.status === "booked"
      ? "paid"
      : initialHold.status === "pending_payment"
        ? "idle"
        : "expired",
  )
  const [receipt, setReceipt] = useState<PaidReceipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [newLinkBusy, setNewLinkBusy] = useState(false)
  // Date.now() can't be called during render (React's purity rule) -- it's
  // read once as useState's lazy initializer (exempt, runs a single time)
  // and refreshed once a second from inside the interval callback below
  // (also exempt: that runs async, not during the render/effect body).
  const [now, setNow] = useState(() => Date.now())

  // Mobile opens this page in an in-app browser with the patient's access
  // token in the URL FRAGMENT (never a query string -- fragments never reach
  // a server log or a Referer header). Stripped from the address bar
  // immediately so it never lingers in browser history either. This is a
  // genuine one-time read of a browser-only API paired with a real side
  // effect (history.replaceState), not state derivable from a prop/state
  // during render, so the usual "derive it instead" fix doesn't apply here.
  const mobileTokenRef = useRef<string | null>(null)
  const [isMobileHandoff, setIsMobileHandoff] = useState(false)
  useEffect(() => {
    const hash = window.location.hash
    const match = /(?:^#|&)access_token=([^&]+)/.exec(hash)
    if (match) {
      mobileTokenRef.current = decodeURIComponent(match[1])
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only browser-API read, see comment above
      setIsMobileHandoff(true)
      history.replaceState(null, "", window.location.pathname + window.location.search)
    }
  }, [])

  useEffect(() => {
    if (hold.status !== "pending_payment" || !hold.hold_expires_at) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [hold.status, hold.hold_expires_at])

  useEffect(() => {
    async function loadProfile() {
      let userId: string | undefined
      if (mobileTokenRef.current) {
        userId = (await supabase.auth.getUser(mobileTokenRef.current)).data.user?.id
      } else {
        userId = (await supabase.auth.getUser()).data.user?.id
      }
      if (userId) setProfile(await fetchPatientProfile(supabase, userId))
    }
    loadProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; isMobileHandoff flips after the fragment-token effect above, which this deliberately waits one tick for via mobileTokenRef being a ref (already set synchronously in that effect, same render pass ordering).
  }, [isMobileHandoff])

  const secondsLeft =
    hold.status === "pending_payment" && hold.hold_expires_at
      ? Math.max(0, Math.round((new Date(hold.hold_expires_at).getTime() - now) / 1000))
      : null
  const effectivePhase: Phase = phase === "idle" && secondsLeft === 0 ? "expired" : phase

  async function getBearerToken(): Promise<string | null> {
    if (mobileTokenRef.current) return mobileTokenRef.current
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }

  async function handlePay() {
    setError(null)
    setPhase("paying")

    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL
    const bearer = await getBearerToken()
    if (!apiBase || !bearer) {
      setError("Please sign in again and retry.")
      setPhase("idle")
      return
    }

    const idField = hold.kind === "token" ? { token_id: holdId } : { appointment_id: holdId }

    try {
      const [orderRes] = await Promise.all([
        fetchWithRetry(`${apiBase}/payments/order`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
          body: JSON.stringify(idField),
        }),
        loadRazorpayScript(),
      ])

      if (!orderRes.ok) {
        if (orderRes.status === 409) {
          setPhase("expired")
        } else {
          setError("Could not start the payment. Please try again.")
          setPhase("idle")
        }
        return
      }
      const order = await orderRes.json()

      const email = isMobileHandoff && mobileTokenRef.current ? emailFromJwt(mobileTokenRef.current) : undefined
      const userEmail = email ?? (await supabase.auth.getUser()).data.user?.email

      const rzp = new window.Razorpay!({
        key: order.key_id,
        amount: order.amount_inr * 100,
        currency: order.currency,
        order_id: order.order_id,
        name: "Queueless",
        description: doctor ? `Consultation with ${doctor.name}` : "Booking fee",
        theme: { color: CHECKOUT_THEME_COLOR },
        prefill: userEmail ? { email: userEmail } : undefined,
        handler: async (response: {
          razorpay_order_id: string
          razorpay_payment_id: string
          razorpay_signature: string
        }) => {
          setPhase("verifying")
          try {
            const verifyRes = await fetchWithRetry(`${apiBase}/payments/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
              body: JSON.stringify({
                ...idField,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            })
            if (!verifyRes.ok) {
              setError("Payment could not be verified. Please contact the desk if you were charged.")
              setPhase("failed")
              return
            }
            setHold((h) => ({ ...h, status: hold.kind === "token" ? "waiting" : "booked" }))
            setReceipt({ razorpayPaymentId: response.razorpay_payment_id, amountInr: order.amount_inr })
            setPhase("paid")
            if (isMobileHandoff) {
              window.location.href = `queueless://paid/${holdId}`
            }
          } catch {
            setError("Payment could not be verified. Please contact the desk if you were charged.")
            setPhase("failed")
          }
        },
        modal: {
          ondismiss: () => setPhase((p) => (p === "paying" ? "idle" : p)),
        },
      })
      rzp.open()
    } catch {
      setError("Could not reach the payment provider. Check your connection and try again.")
      setPhase("idle")
    }
  }

  async function handleCancelBooking() {
    setCancelBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc("cancel_hold", { p_id: holdId })
    setCancelBusy(false)
    if (rpcError) {
      setError("Could not cancel. Please try again.")
      return
    }
    setPhase("cancelled")
  }

  // A lapsed hold is gone (its slot/number already went back to other patients), so this can't
  // resume the SAME hold -- for a walk-in token it can still get the patient a fresh one with
  // one tap, same doctor, no re-navigating; an appointment hold needs a slot re-picked, so that
  // one goes back to the dashboard instead of a dead end.
  async function handleGetNewLink() {
    setNewLinkBusy(true)
    setError(null)
    if (hold.kind === "token" && hold.doctor_id) {
      const { data, error: rpcError } = await supabase.rpc("start_paid_booking", { p_doctor_id: hold.doctor_id })
      setNewLinkBusy(false)
      if (rpcError || !data?.id) {
        setError("Could not get a new payment link. Please try again.")
        return
      }
      router.push(`/pay/${data.id}`)
      return
    }
    setNewLinkBusy(false)
    router.push("/my")
  }

  const feeInr = hold.fee_inr ?? 0
  const totalInr = feeInr + PLATFORM_FEE_INR

  return (
    <main id="main" className={styles.page}>
      <div className={styles.band}>
        <LogoMark size={300} className={styles.bandMark} />
        <TwoToneHeading as="h1" lead="Book &" accent="pay" onDark align="center" />
      </div>

      <div className={styles.card}>
        <p className={styles.testBanner} role="note">
          Test payments. No real money moves. Use card <code>4111 1111 1111 1111</code>, any
          future expiry, any CVV. (UPI isn&rsquo;t enabled on this account yet.)
        </p>

        {error && <p className={styles.error}>{error}</p>}

        {(effectivePhase === "idle" || effectivePhase === "paying" || effectivePhase === "verifying") && (
          <div aria-live="polite" aria-atomic="true">
            <div className={styles.doctorCard}>
              <span className={styles.avatar}>{initials(doctor?.name ?? null)}</span>
              <div className={styles.doctorInfo}>
                <span className={styles.doctorName}>{doctor ? doctor.name : "Booking"}</span>
                {doctor && <span className={styles.doctorSpecialty}>{doctor.specialty}</span>}
                <span className={styles.doctorWhen}>
                  {hold.startsAt ? formatWhen(hold.startsAt) : "Walk-in token"}
                </span>
              </div>
            </div>

            <div className={styles.patientRow}>
              <div>
                <span className={styles.patientName}>{profile?.full_name ?? "Your details"}</span>
                {profile?.phone && <span className={styles.patientPhone}>{profile.phone}</span>}
              </div>
              <a href="/my/profile" className={styles.editLink}>
                Edit
              </a>
            </div>

            <div className={styles.priceBreakdown}>
              <div className={styles.priceRow}>
                <span>Consultation fee</span>
                <span>₹{feeInr}</span>
              </div>
              <div className={styles.priceRow}>
                <span>Platform fee</span>
                <span className={styles.waived}>₹{PLATFORM_FEE_INR} waived</span>
              </div>
              <div className={styles.priceRowTotal}>
                <span>Total</span>
                <span>₹{totalInr}</span>
              </div>
            </div>

            {secondsLeft !== null && (
              <p className={styles.hold}>
                Slot held for <strong className={styles.countdown}>{formatCountdown(secondsLeft)}</strong>
              </p>
            )}

            <p className={styles.policy}>
              Refunds are automatic if the doctor goes on leave. Otherwise, cancellations are
              reviewed by the clinic admin.
            </p>

            <div className={styles.stickyBar}>
              <span className={styles.stickyTotal}>₹{totalInr}</span>
              <button
                type="button"
                className={styles.cta}
                onClick={handlePay}
                disabled={effectivePhase !== "idle"}
              >
                {effectivePhase === "paying"
                  ? "Opening payment…"
                  : effectivePhase === "verifying"
                    ? "Confirming…"
                    : "Proceed to payment"}
              </button>
            </div>
          </div>
        )}

        {effectivePhase === "paid" && (
          <div className={styles.successBox}>
            <span className={styles.checkCircle} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <p className={styles.line}>Payment confirmed. Your spot is booked.</p>
            <div className={styles.receipt}>
              {hold.code && (
                <div className={styles.receiptRow}>
                  <span>Code</span>
                  <span>{hold.code}</span>
                </div>
              )}
              {hold.startsAt && (
                <div className={styles.receiptRow}>
                  <span>When</span>
                  <span>{formatWhen(hold.startsAt)}</span>
                </div>
              )}
              {receipt && (
                <>
                  <div className={styles.receiptRow}>
                    <span>Amount paid</span>
                    <span>₹{receipt.amountInr}</span>
                  </div>
                  <div className={styles.receiptRow}>
                    <span>Payment ID</span>
                    <span className={styles.mono}>{receipt.razorpayPaymentId}</span>
                  </div>
                </>
              )}
            </div>
            {!isMobileHandoff && (
              <>
                <a href={hold.kind === "token" ? `/t/${holdId}` : "/my"} className={styles.cta}>
                  View live status
                </a>
                {hold.startsAt && (
                  <button type="button" className={styles.ctaSecondary} onClick={() => downloadIcs(hold, doctor)}>
                    Add to calendar
                  </button>
                )}
              </>
            )}
            {isMobileHandoff && <p className={styles.line}>Returning to the app…</p>}
          </div>
        )}

        {effectivePhase === "failed" && (
          <div className={styles.successBox}>
            <p className={styles.line}>
              {error ?? "Something went wrong confirming your payment."} Your spot is still held —
              you can try again before the hold expires.
            </p>
            <button type="button" className={styles.cta} onClick={handlePay}>
              Try again
            </button>
            <button type="button" className={styles.ctaSecondary} disabled={cancelBusy} onClick={handleCancelBooking}>
              {cancelBusy ? "Cancelling…" : "Cancel booking"}
            </button>
          </div>
        )}

        {effectivePhase === "cancelled" && (
          <p className={styles.line}>This booking was cancelled. Go back and book again anytime.</p>
        )}

        {effectivePhase === "expired" && (
          <div className={styles.successBox}>
            <p className={styles.line}>This hold has expired and the spot was released.</p>
            <button type="button" className={styles.cta} disabled={newLinkBusy} onClick={handleGetNewLink}>
              {newLinkBusy ? "One moment…" : "Get a new payment link"}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
