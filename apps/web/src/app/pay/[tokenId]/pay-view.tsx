"use client"

import { useEffect, useRef, useState } from "react"

import { LogoMark } from "@/components/brand/Logo"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"
import { createClient } from "@/lib/supabase/client"
import type { DoctorRow, PayableToken } from "./data"
import styles from "./pay.module.css"

const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v2/checkout.js"
const CHECKOUT_THEME_COLOR = "#0cb7d6"

type Phase = "idle" | "paying" | "verifying" | "paid" | "failed" | "expired"

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
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

export function PayView({
  tokenId,
  initialToken,
  doctor,
}: {
  tokenId: string
  initialToken: PayableToken
  doctor: DoctorRow | null
}) {
  const [supabase] = useState(() => createClient())
  const [token, setToken] = useState(initialToken)
  const [phase, setPhase] = useState<Phase>(() =>
    initialToken.status === "waiting" ? "paid" : initialToken.status === "pending_payment" ? "idle" : "expired",
  )
  const [error, setError] = useState<string | null>(null)
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
    if (token.status !== "pending_payment" || !token.hold_expires_at) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [token.status, token.hold_expires_at])

  const secondsLeft =
    token.status === "pending_payment" && token.hold_expires_at
      ? Math.max(0, Math.round((new Date(token.hold_expires_at).getTime() - now) / 1000))
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

    try {
      const [orderRes] = await Promise.all([
        fetch(`${apiBase}/payments/order`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ token_id: tokenId }),
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
            const verifyRes = await fetch(`${apiBase}/payments/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
              body: JSON.stringify({
                token_id: tokenId,
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
            setToken((t) => ({ ...t, status: "waiting" }))
            setPhase("paid")
            if (isMobileHandoff) {
              window.location.href = `queueless://paid/${tokenId}`
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

  return (
    <main id="main" className={styles.page}>
      <div className={styles.band}>
        <LogoMark size={300} className={styles.bandMark} />
        <TwoToneHeading as="h1" lead="Book &" accent="pay" onDark align="center" />
      </div>

      <div className={styles.card}>
        <p className={styles.testBanner} role="note">
          Test payments — no real money moves. Use UPI ID <code>success@razorpay</code> to
          simulate a successful payment.
        </p>

        <div className={styles.summary}>
          <span className={styles.summaryLabel}>{doctor ? doctor.name : "Booking"}</span>
          {doctor && <span className={styles.summarySpecialty}>{doctor.specialty}</span>}
          <span className={styles.fee}>₹{token.fee_inr ?? 0}</span>
        </div>

        <div aria-live="polite" aria-atomic="true">
          {effectivePhase === "idle" && secondsLeft !== null && (
            <p className={styles.hold}>
              Spot held for <strong className={styles.countdown}>{formatCountdown(secondsLeft)}</strong>
            </p>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {(effectivePhase === "idle" || effectivePhase === "paying") && (
            <button
              type="button"
              className={styles.cta}
              onClick={handlePay}
              disabled={effectivePhase === "paying"}
            >
              {effectivePhase === "paying" ? "Opening payment…" : "Pay & confirm"}
            </button>
          )}

          {effectivePhase === "verifying" && <p className={styles.line}>Confirming your payment…</p>}

          {effectivePhase === "paid" && !isMobileHandoff && (
            <div className={styles.successBox}>
              <p className={styles.line}>Payment confirmed. Your spot is booked.</p>
              <a href={`/t/${tokenId}`} className={styles.cta}>
                View your token
              </a>
            </div>
          )}

          {effectivePhase === "paid" && isMobileHandoff && (
            <p className={styles.line}>Payment confirmed. Returning to the app…</p>
          )}

          {effectivePhase === "failed" && (
            <button type="button" className={styles.ctaSecondary} onClick={handlePay}>
              Retry payment
            </button>
          )}

          {effectivePhase === "expired" && (
            <p className={styles.line}>
              This hold has expired and the spot was released. Go back and book again.
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
