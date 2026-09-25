"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { LogoMark } from "@/components/brand/Logo"
import { QueueTracker } from "@/components/motion/QueueTracker"
import { useEtaAtJoin, useNowServing } from "@/components/motion/useQueueExtras"
import { TwoToneHeading } from "@/components/site/TwoToneHeading"
import { createClient } from "@/lib/supabase/client"
import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import {
  countOpenCounters,
  countTokensAhead,
  fetchCounter,
  fetchToken,
  type CounterRow,
  type ServiceRow,
  type TokenRow,
} from "./data"
import { fetchPrediction } from "./predict"
import styles from "./status.module.css"

const STATUS_LABEL: Record<TokenRow["status"], string> = {
  waiting: "Waiting",
  called: "Called",
  serving: "Being served",
  done: "Done",
  skipped: "Skipped",
  no_show: "No-show",
  cancelled: "Cancelled",
  pending_payment: "Awaiting payment",
}

const STATUS_BADGE_CLASS: Record<TokenRow["status"], string> = {
  waiting: styles.badgeWaiting,
  called: styles.badgeCalled,
  serving: styles.badgeCalled,
  done: styles.badgeDone,
  skipped: styles.badgeNoShow,
  no_show: styles.badgeNoShow,
  cancelled: styles.badgeNoShow,
  pending_payment: styles.badgeWaiting,
}

// Live refresh cadence for the derived, not-realtime-pushed numbers (position
// and ETA change as OTHER tokens move, and the realtime channel below is
// filtered to this token's own row only). 20s keeps the demo feeling live
// without leaning on the FastAPI /predict rate limit (60/min per IP).
const REFRESH_MS = 20_000

export function StatusView({
  tokenId,
  initialToken,
  service,
  initialCounter,
  initialQueueAhead,
  initialPredictedWaitMinutes,
  initialPredictedIsFallback,
}: {
  tokenId: string
  initialToken: TokenRow
  service: ServiceRow | null
  initialCounter: CounterRow | null
  initialQueueAhead: number | null
  initialPredictedWaitMinutes: number | null
  initialPredictedIsFallback: boolean
}) {
  const [supabase] = useState(() => createClient())
  const [token, setToken] = useState(initialToken)
  const [counter, setCounter] = useState(initialCounter)
  const [queueAhead, setQueueAhead] = useState(initialQueueAhead)
  const [predictedWaitMinutes, setPredictedWaitMinutes] = useState(initialPredictedWaitMinutes)
  const [predictedIsFallback, setPredictedIsFallback] = useState(initialPredictedIsFallback)

  const serviceId = service?.id ?? null

  // Param left untyped -- contextually inferred as the hook's own `any`
  // (see useResilientChannel's note); narrowed to TokenRow right here instead.
  const onEvent = useCallback((payload: { new?: TokenRow | null }) => {
    const next = payload.new
    if (next) setToken(next)
  }, [])

  useResilientChannel({
    channelName: `token-status-${tokenId}`,
    table: "tokens",
    filter: `id=eq.${tokenId}`,
    onEvent,
  })

  // Fallback for QA #1: postgres_changes can silently stop delivering to an
  // already-open anon tab (RLS/subscription gap), and the resilient channel's
  // own reconnect logic only fires on a transport-level drop, not a silent
  // stall. A 10s poll plus an immediate refetch on tab focus/visibility puts a
  // hard ceiling on staleness regardless of why the push failed. Cheap: one
  // row by primary key.
  useEffect(() => {
    let cancelled = false
    const refetch = () => {
      fetchToken(supabase, tokenId).then((row) => {
        if (!cancelled && row) setToken(row)
      })
    }
    const interval = setInterval(refetch, 10_000)
    const handleVisible = () => {
      if (document.visibilityState === "visible") refetch()
    }
    document.addEventListener("visibilitychange", handleVisible)
    window.addEventListener("focus", refetch)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisible)
      window.removeEventListener("focus", refetch)
    }
  }, [supabase, tokenId])

  // Look up the new counter's name whenever the counter this token is
  // assigned to changes (realtime payloads carry raw columns only, not the
  // joined counter row the initial server render used). `displayCounter`
  // below only shows a fetched row while it still matches the current
  // counter_id, so a stale name never lingers on-screen mid-fetch and no
  // synchronous setState is needed here for the "cleared" case.
  useEffect(() => {
    if (!token.counter_id || token.counter_id === counter?.id) return
    let cancelled = false
    fetchCounter(supabase, token.counter_id).then((row) => {
      if (!cancelled) setCounter(row)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.counter_id])
  const displayCounter = counter && counter.id === token.counter_id ? counter : null
  const nowServing = useNowServing(token.service_id, token.service_day)
  const etaMinutes = predictedWaitMinutes === null ? null : Math.max(0, Math.round(predictedWaitMinutes))
  const etaAtJoin = useEtaAtJoin(tokenId, etaMinutes)

  // Refresh position + ETA periodically while still waiting -- these are
  // derived from every other waiting token in the service, which the
  // per-row realtime filter above deliberately doesn't watch.
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])
  useEffect(() => {
    if (token.status !== "waiting") return
    let cancelled = false

    async function refresh() {
      const current = tokenRef.current
      const ahead = await countTokensAhead(supabase, current)
      if (cancelled) return
      setQueueAhead(ahead)
      if (ahead !== null && serviceId) {
        const countersOpen = await countOpenCounters(supabase, current.service_id)
        const prediction = await fetchPrediction(serviceId, ahead, countersOpen)
        if (!cancelled && prediction) {
          setPredictedWaitMinutes(prediction.predictedWaitMinutes)
          setPredictedIsFallback(prediction.fallback)
        }
      }
    }

    const interval = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.status, serviceId])

  return (
    <main id="main" className={styles.page}>
      <div className={styles.band}>
        <LogoMark size={300} className={styles.bandMark} />
        <TwoToneHeading as="h1" lead="Your" accent="token" onDark align="center" />
      </div>
      <div className={styles.card} data-status={token.status}>
        {/* Turns solid cyan when the token is called: the loudest moment. */}
        <div className={styles.head}>
          <div className={styles.tokenNumber} translate="no">
            {token.code}
          </div>
          <div className={styles.meta}>
            <span className={styles.service}>{service?.name ?? "Queueless"}</span>
            <span className={`${styles.badge} ${STATUS_BADGE_CLASS[token.status]}`}>
              {STATUS_LABEL[token.status]}
            </span>
          </div>
        </div>

        <QueueTracker
          status={token.status}
          ahead={queueAhead}
          etaMinutes={etaMinutes}
          etaAtJoin={etaAtJoin}
          etaIsRough={predictedIsFallback}
          counterCode={displayCounter?.name ?? null}
          nowServingNumber={nowServing}
          serviceName={service?.name ?? null}
        />

        <p className={styles.footer}>Updates automatically. No need to refresh.</p>
      </div>
    </main>
  )
}
