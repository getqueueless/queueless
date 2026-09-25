"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import {
  countOpenCounters,
  countTokensAhead,
  fetchCounter,
  type CounterRow,
  type ServiceRow,
  type TokenRow,
} from "./data"
import { fetchPrediction, mapServiceToPredictSlug } from "./predict"
import styles from "./status.module.css"

const STATUS_LABEL: Record<TokenRow["status"], string> = {
  waiting: "Waiting",
  called: "Called",
  serving: "Being served",
  done: "Done",
  skipped: "Skipped",
  no_show: "No-show",
  cancelled: "Cancelled",
}

const STATUS_BADGE_CLASS: Record<TokenRow["status"], string> = {
  waiting: styles.badgeWaiting,
  called: styles.badgeCalled,
  serving: styles.badgeCalled,
  done: styles.badgeDone,
  skipped: styles.badgeNoShow,
  no_show: styles.badgeNoShow,
  cancelled: styles.badgeNoShow,
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

  const predictSlug = service ? mapServiceToPredictSlug(service) : null

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
      if (ahead !== null && predictSlug) {
        const countersOpen = await countOpenCounters(supabase, current.service_id)
        const prediction = await fetchPrediction(predictSlug, ahead, countersOpen)
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
  }, [token.status, predictSlug])

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>{service?.name ?? "Queueless"}</p>
        <div className={styles.tokenNumber}>{token.code}</div>
        <span className={`${styles.badge} ${STATUS_BADGE_CLASS[token.status]}`}>
          {STATUS_LABEL[token.status]}
        </span>

        {token.status === "waiting" && (
          <div className={styles.body}>
            <p className={styles.line}>
              {queueAhead === null
                ? "Position in queue is unavailable right now."
                : queueAhead === 0
                  ? "You're next."
                  : `${queueAhead} ${queueAhead === 1 ? "person" : "people"} ahead of you.`}
            </p>
            {predictedWaitMinutes !== null && (
              <p className={styles.eta}>
                Estimated wait: ~{Math.max(0, Math.round(predictedWaitMinutes))} min
                {predictedIsFallback && <span className={styles.etaNote}> (rough estimate)</span>}
              </p>
            )}
          </div>
        )}

        {(token.status === "called" || token.status === "serving") && (
          <div className={styles.body}>
            <p className={styles.lineUrgent}>
              {token.status === "called" ? "You're being called now." : "You're being served."}
            </p>
            {displayCounter && <p className={styles.line}>Go to {displayCounter.name}.</p>}
          </div>
        )}

        {token.status === "done" && (
          <div className={styles.body}>
            <p className={styles.line}>Visit complete. Thank you.</p>
          </div>
        )}

        {token.status === "no_show" && (
          <div className={styles.body}>
            <p className={styles.line}>Marked as a no-show. See the counter to be re-added.</p>
          </div>
        )}

        {token.status === "skipped" && (
          <div className={styles.body}>
            <p className={styles.line}>You were skipped. Check in with the counter.</p>
          </div>
        )}

        {token.status === "cancelled" && (
          <div className={styles.body}>
            <p className={styles.line}>This token was cancelled.</p>
          </div>
        )}

        <p className={styles.footer}>Updates automatically — no need to refresh.</p>
      </div>
    </main>
  )
}
