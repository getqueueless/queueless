"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { countOpenCounters, fetchCounter, type TokenStatus } from "@/app/t/[id]/data"
import { fetchPrediction } from "@/app/t/[id]/predict"
import { QueueTracker } from "@/components/motion/QueueTracker"
import { useEtaAtJoin, useNowServing } from "@/components/motion/useQueueExtras"
import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import { createClient } from "@/lib/supabase/client"

import { readTokenStatus, type ActiveToken } from "./data"
import { TOKEN_STATUS } from "./format"
import { ArrowIcon } from "./icons"
import styles from "./TokenCard.module.css"
import ui from "./ui.module.css"

// Position and estimate move when OTHER tokens move, which this token's own
// broadcast topic never reports, so they are re-read on a timer. Same 20s as
// /t/[id]: live enough, and well under /predict's 60/min per-IP limit (the
// call runs in the patient's browser, so the limit is theirs, not the server's).
const REFRESH_MS = 20_000

export function TokenCard({ initial }: { initial: ActiveToken }) {
  const [supabase] = useState(() => createClient())
  const [token, setToken] = useState(initial.token)
  const [ahead, setAhead] = useState(initial.ahead)
  const [counter, setCounter] = useState(initial.counter)
  const [eta, setEta] = useState<{ minutes: number; rough: boolean } | null>(null)
  const id = initial.token.id

  // token:<id> carries status + counter only (migration 0044), so merge it.
  const onEvent = useCallback((p: { status?: TokenStatus; counter_id?: string | null }) => {
    if (p.status) setToken((prev) => ({ ...prev, status: p.status!, counter_id: p.counter_id ?? null }))
  }, [])
  useResilientChannel({ channelName: `token:${id}`, broadcastEvent: "token_update", onEvent })

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const read = await readTokenStatus(supabase, id)
      if (cancelled || !read) return
      const { token: row, ahead: n } = read
      setToken(row)
      setAhead(n)
      if (n === null) return
      const prediction = await fetchPrediction(row.service_id, n, await countOpenCounters(supabase, row.service_id))
      if (!cancelled && prediction) {
        setEta({ minutes: Math.max(0, Math.round(prediction.predictedWaitMinutes)), rough: prediction.fallback })
      }
    }
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [supabase, id])

  // Realtime payloads carry a counter id, not its name.
  useEffect(() => {
    if (!token.counter_id || token.counter_id === counter?.id) return
    let cancelled = false
    fetchCounter(supabase, token.counter_id).then((row) => {
      if (!cancelled) setCounter(row)
    })
    return () => {
      cancelled = true
    }
  }, [supabase, token.counter_id, counter?.id])

  const nowServing = useNowServing(token.service_id, token.service_day)
  const etaAtJoin = useEtaAtJoin(id, eta?.minutes ?? null)
  const status = TOKEN_STATUS[token.status]
  const pending = token.status === "pending_payment"
  const counterName = counter && counter.id === token.counter_id ? counter.name : null

  return (
    <article className={styles.card} aria-labelledby="live-token-code" data-status={token.status}>
      <div className={styles.head}>
        <div className={styles.id}>
          <h2 id="live-token-code" className={styles.code} translate="no">
            <span className={ui.srOnly}>Your token </span>
            {token.code}
          </h2>
          <p className={styles.meta}>
            {initial.serviceName}
            {initial.doctorName && (
              <>
                <span aria-hidden="true"> · </span>
                <span translate="no">{initial.doctorName}</span>
              </>
            )}
          </p>
        </div>
        <span className={ui.chip} data-tone={status.tone}>
          {status.label}
        </span>
      </div>

      {token.status === "waiting" && ahead !== null && (
        <p className={styles.ahead}>
          {ahead === 0 ? (
            "Nobody ahead of you. You are next."
          ) : (
            <>
              <strong>{ahead}</strong> {ahead === 1 ? "person" : "people"} ahead of you
            </>
          )}
        </p>
      )}

      <div className={styles.tracker}>
        <QueueTracker
          status={token.status}
          ahead={ahead}
          etaMinutes={eta?.minutes ?? null}
          etaAtJoin={etaAtJoin}
          counterCode={counterName}
          nowServingNumber={nowServing}
          serviceName={initial.serviceName}
          etaIsRough={eta?.rough}
        />
      </div>

      <Link href={pending ? `/pay/${id}` : `/t/${id}`} className={styles.cta}>
        {pending ? "Finish payment" : "View live status"}
        <ArrowIcon />
      </Link>
    </article>
  )
}
