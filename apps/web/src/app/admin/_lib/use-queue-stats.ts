"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import { describeSupabaseError } from "./describe-error"
import { fetchPredictedWait } from "./predict"
import type { BoardServiceRow, ServiceRow, TokenRow } from "./types"

// A filter that matches no real row -- used to keep the realtime hooks below
// unconditional (React hooks can't be called conditionally) when no service
// is selected yet, instead of subscribing to every token/board row.
const NO_MATCH_FILTER = "service_id=eq.00000000-0000-0000-0000-000000000000"

export type QueueStats = {
  queueLength: number
  avgWaitMinutes: number | null
  avgServiceMinutes: number | null
  tokensPerHour: number
  noShowRate: number | null
}

export type WaitChartPoint = { hour: string; predicted: number; actual: number }

type State = {
  loading: boolean
  error: string | null
  stats: QueueStats | null
  chart: WaitChartPoint[]
  chartNote: string | null
}

const REFRESH_MS = 15_000
// ponytail: naive replay -- predicts each past hour using *today's* current
// queue length/open-counter count rather than what those were at that hour.
// Good enough for a demo "peak hour shape" chart; upgrade to logging
// queue_len_ahead/counters_open per token if the judged claim needs to be
// "this is what we predicted at the time."
async function buildChart(
  service: ServiceRow,
  tokens: TokenRow[],
  queueLength: number,
  countersOpen: number,
  apiBaseUrl: string | undefined,
): Promise<{ chart: WaitChartPoint[]; note: string | null }> {
  const byHour = new Map<number, number[]>()
  for (const t of tokens) {
    if (!t.called_at) continue
    const waitMin = (new Date(t.called_at).getTime() - new Date(t.created_at).getTime()) / 60_000
    if (waitMin < 0) continue
    const hour = new Date(t.created_at).getHours()
    const list = byHour.get(hour) ?? []
    list.push(waitMin)
    byHour.set(hour, list)
  }

  const hours = [...byHour.keys()].sort((a, b) => a - b)
  if (hours.length === 0) return { chart: [], note: "Not enough called tokens yet to chart wait times." }

  const weekday = (new Date().getDay() + 6) % 7 // JS: 0=Sun -> API: 0=Mon

  let note: string | null = null
  const chart: WaitChartPoint[] = []
  for (const hour of hours) {
    const waits = byHour.get(hour)!
    const actual = waits.reduce((a, b) => a + b, 0) / waits.length

    const result = await fetchPredictedWait(apiBaseUrl, {
      serviceId: service.id,
      hour,
      weekday,
      queueLenAhead: queueLength,
      countersOpen,
    })
    const predicted = result.ok ? result.predictedWaitMinutes : 0
    if (!result.ok && !note) note = `Prediction not available yet: ${result.reason}.`

    chart.push({ hour: `${hour.toString().padStart(2, "0")}:00`, predicted: Math.round(predicted), actual: Math.round(actual) })
  }

  return { chart, note }
}

const EMPTY_STATE: State = { loading: false, error: null, stats: null, chart: [], chartNote: null }

export function useQueueStats(service: ServiceRow | null) {
  const [state, setState] = useState<State>(() => (service ? { ...EMPTY_STATE, loading: true } : EMPTY_STATE))
  const loadRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!service) return

    const supabase = createClient()
    let cancelled = false

    async function load() {
      if (!service) return
      const today = new Date().toISOString().slice(0, 10)
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const [boardRes, tokensRes, countersRes] = await Promise.all([
        supabase
          .from("board_services")
          .select("service_id, day, org_id, waiting_count, served_count, no_show_count, last_called_code, avg_service_secs, updated_at")
          .eq("service_id", service.id)
          .eq("day", today)
          .maybeSingle(),
        supabase
          .from("tokens")
          .select("id, org_id, service_id, service_day, number, code, status, counter_id, created_at, called_at, serving_at, finished_at")
          .eq("service_id", service.id)
          .gte("created_at", since),
        supabase
          .from("counter_services")
          .select("counter_id, counters!inner(state)")
          .eq("service_id", service.id)
          .eq("counters.state", "open"),
      ])

      if (cancelled) return

      if (tokensRes.error) {
        setState((s) => ({ ...s, loading: false, error: describeSupabaseError(tokensRes.error) }))
        return
      }

      const tokens = (tokensRes.data ?? []) as unknown as TokenRow[]
      const board = boardRes.data as BoardServiceRow | null

      const waitingCount = board?.waiting_count ?? tokens.filter((t) => t.status === "waiting").length
      const servedCount = board?.served_count ?? tokens.filter((t) => t.status === "done").length
      const noShowCount = board?.no_show_count ?? tokens.filter((t) => t.status === "no_show").length
      const denom = servedCount + noShowCount
      const noShowRate = denom > 0 ? noShowCount / denom : null

      const waitMinutes = tokens
        .filter((t) => t.called_at)
        .map((t) => (new Date(t.called_at!).getTime() - new Date(t.created_at).getTime()) / 60_000)
        .filter((m) => m >= 0)
      const avgWaitMinutes = waitMinutes.length ? waitMinutes.reduce((a, b) => a + b, 0) / waitMinutes.length : null

      let avgServiceMinutes: number | null = board?.avg_service_secs != null ? board.avg_service_secs / 60 : null
      if (avgServiceMinutes == null) {
        const serviceMinutes = tokens
          .filter((t) => t.serving_at && t.finished_at)
          .map((t) => (new Date(t.finished_at!).getTime() - new Date(t.serving_at!).getTime()) / 60_000)
          .filter((m) => m >= 0)
        avgServiceMinutes = serviceMinutes.length ? serviceMinutes.reduce((a, b) => a + b, 0) / serviceMinutes.length : null
      }

      const hoursElapsed = Math.max(1, (Date.now() - new Date().setHours(0, 0, 0, 0)) / (60 * 60 * 1000))
      const tokensPerHour = servedCount / hoursElapsed

      const countersOpen = countersRes.error ? 1 : Math.max(1, (countersRes.data ?? []).length)

      const { chart, note } = await buildChart(service, tokens, waitingCount, countersOpen, process.env.NEXT_PUBLIC_API_BASE_URL)
      if (cancelled) return

      setState({
        loading: false,
        error: null,
        stats: { queueLength: waitingCount, avgWaitMinutes, avgServiceMinutes, tokensPerHour, noShowRate },
        chart,
        chartNote: note,
      })
    }

    loadRef.current = load
    // Fetching on mount/dependency-change and polling underneath is the
    // react.dev-documented shape for this; the realtime subscriptions below
    // (via the shared useResilientChannel hook) are the fast path on top of
    // this safety net -- they just call loadRef.current() when something
    // changes, they don't replace it.
    load()
    const interval = setInterval(load, REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [service])

  const onChange = useCallback(() => loadRef.current(), [])

  // Realtime-fed: any change to this service's tokens/board row triggers a
  // refresh via the shared reconnecting-channel hook. Polling above is the
  // safety net if Realtime publications for these tables haven't been wired
  // up by the DB agent yet -- either way the dashboard stays live within
  // REFRESH_MS.
  useResilientChannel({
    channelName: `admin-tokens-${service?.id ?? "none"}`,
    table: "tokens",
    filter: service ? `service_id=eq.${service.id}` : NO_MATCH_FILTER,
    onEvent: onChange,
  })
  useResilientChannel({
    channelName: `admin-board-${service?.id ?? "none"}`,
    table: "board_services",
    filter: service ? `service_id=eq.${service.id}` : NO_MATCH_FILTER,
    onEvent: onChange,
  })

  if (!service) return EMPTY_STATE
  return state
}
