"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"

import { countOpenCounters, fetchCounter, type TokenStatus } from "@/app/t/[id]/data"
import { fetchPrediction } from "@/app/t/[id]/predict"
import { useEtaAtJoin } from "@/components/motion/useQueueExtras"
import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import { createClient } from "@/lib/supabase/client"

import { ACTIVE_STATUSES, readTokenStatus, type LiveToken } from "./active-token"
import styles from "./ActiveTokenBar.module.css"

// Status poll, same 10s floor as /t/[id]. The model is asked again only when
// the line moved, or every third poll so a stale estimate still refreshes,
// keeping this well under /predict's 60/min per-IP limit.
const POLL_MS = 10_000
const PREDICT_EVERY = 3

type Eta = { minutes: number; at: number }

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * The patient's live token as a slim sticky strip: code and stage, a
 * progress line toward their turn, and a countdown. Renders nothing when
 * there is no active token. Key it by token id where it is mounted, so a new
 * token starts a fresh bar.
 */
export function ActiveTokenBar({ initial }: { initial: LiveToken | null }) {
  if (!initial) return null
  return <Bar initial={initial} />
}

function Bar({ initial }: { initial: LiveToken }) {
  const [supabase] = useState(() => createClient())
  const [token, setToken] = useState(initial.token)
  const [ahead, setAhead] = useState(initial.ahead)
  const [counterName, setCounterName] = useState<string | null>(null)
  const [eta, setEta] = useState<Eta | null>(null)
  const [now, setNow] = useState<number | null>(null)
  const polls = useRef(0)
  const lastAhead = useRef<number | null>(null)
  const id = initial.token.id

  const onEvent = useCallback((p: { status?: TokenStatus; counter_id?: string | null }) => {
    if (p.status) setToken((prev) => ({ ...prev, status: p.status!, counter_id: p.counter_id ?? null }))
  }, [])
  useResilientChannel({ channelName: `token:${id}`, broadcastEvent: "token_update", onEvent })

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      const read = await readTokenStatus(supabase, id)
      if (cancelled || !read) return
      setToken(read.token)
      setAhead(read.ahead)
      const n = read.ahead
      polls.current++
      if (n === null || (n === lastAhead.current && polls.current % PREDICT_EVERY !== 1)) return
      lastAhead.current = n
      const prediction = await fetchPrediction(read.token.service_id, n, await countOpenCounters(supabase, read.token.service_id))
      if (!cancelled && prediction) {
        setEta({ minutes: Math.max(0, prediction.predictedWaitMinutes), at: Date.now() })
      }
    }
    const first = setTimeout(refresh, 0)
    const timer = setInterval(refresh, POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [supabase, id])

  // Counter names are not in the broadcast; look one up when it changes.
  useEffect(() => {
    if (!token.counter_id) return
    let cancelled = false
    fetchCounter(supabase, token.counter_id).then((row) => {
      if (!cancelled) setCounterName(row?.name ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [supabase, token.counter_id])

  // The countdown ticks between estimates; each new estimate re-syncs it.
  const waiting = token.status === "waiting"
  useEffect(() => {
    if (!waiting || !eta) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [waiting, eta])

  const etaMinutes = eta ? Math.round(eta.minutes) : null
  const etaAtJoin = useEtaAtJoin(id, etaMinutes)

  if (!ACTIVE_STATUSES.includes(token.status)) return null

  const counter = !counterName ? "the counter" : /^counter\b/i.test(counterName) ? counterName : `Counter ${counterName}`
  const called = token.status === "called"
  const pending = token.status === "pending_payment"
  const stage = pending
    ? "Awaiting payment"
    : called
      ? `Called → ${counter}`
      : token.status === "serving"
        ? "With the doctor"
        : ahead === 0
          ? "You're next"
          : "Waiting"

  const left = eta ? eta.minutes * 60 - ((now ?? eta.at) - eta.at) / 1000 : null
  const progress =
    called || token.status === "serving"
      ? 1
      : waiting && eta && etaAtJoin
        ? Math.min(1, Math.max(0, 1 - eta.minutes / etaAtJoin))
        : 0

  return (
    <Link
      href={pending ? `/pay/${id}` : `/t/${id}`}
      className={styles.bar}
      data-status={token.status}
      aria-label={`Token ${token.code}: ${stage}. Open live status.`}
    >
      <span className={styles.id}>
        <span className={styles.code} translate="no">
          {token.code}
        </span>
        <span className={styles.stage}>{stage}</span>
      </span>

      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ "--p": progress } as CSSProperties} />
      </span>

      <span className={styles.right}>
        {called ? (
          <span className={styles.go}>Go to {counter}</span>
        ) : pending ? (
          "Finish payment"
        ) : token.status === "serving" ? (
          "Your turn"
        ) : left === null ? (
          <span className={styles.muted}>Estimating wait</span>
        ) : left <= 0 ? (
          "Any moment now"
        ) : (
          <span className={styles.timer}>~{clock(left)} left</span>
        )}
      </span>
    </Link>
  )
}
