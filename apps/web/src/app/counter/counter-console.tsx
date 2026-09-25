"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ERRORS, errorInfo } from "@queueless/db"

import { createClient } from "@/lib/supabase/client"
import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import { ACTIVE_TOKEN_STATUSES, type CounterRow, type Lane, type TokenRow } from "./types"
import styles from "./counter.module.css"

type Banner = { kind: "error" | "info"; text: string } | null

const LANE_LABELS: Record<Lane, string> = {
  emergency: "Emergency",
  senior: "Senior",
  pregnant: "Pregnant",
  appointment: "Appointment",
  normal: "Normal",
}

// RPC errors surface as PostgrestError, but a self-hosted Postgres exception
// (`raise exception 'counter_busy'`) can land its semantic code as either
// `.code` or `.message` depending on how the DB agent's function raises it --
// same shape as apps/mobile/src/lib/errors.ts's mapSupabaseError, kept local
// here since apps/mobile and apps/web can't import across app boundaries.
const KNOWN_CODES = new Set(Object.keys(ERRORS))
function mapSupabaseError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return errorInfo("network_error").message
  const code = error.code && KNOWN_CODES.has(error.code) ? error.code : undefined
  const fromMessage =
    !code && error.message && KNOWN_CODES.has(error.message) ? error.message : undefined
  return errorInfo(code ?? fromMessage ?? "network_error").message
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function CounterConsole({
  counter,
  initialToken,
  serviceLabel,
  staffName,
}: {
  counter: CounterRow
  initialToken: TokenRow | null
  serviceLabel: string
  staffName: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [current, setCurrent] = useState<TokenRow | null>(initialToken)
  const [banner, setBanner] = useState<Banner>(null)
  const [pending, setPending] = useState(false)
  // Starts null (not Date.now()) so server and client render the same
  // "00:00" on the first pass -- seeding this from the wall clock made the
  // server's render timestamp and the client's hydration timestamp differ by
  // however many ms/seconds passed in between, throwing a hydration
  // mismatch (React error #418). The real ticking value is only ever set
  // client-side, after mount, once hydration has already committed.
  const [now, setNow] = useState<number | null>(null)
  const pendingRef = useRef(false)

  // `counter` is a prop, set once from the page's initial server fetch --
  // an admin opening/closing this desk from /admin/counters never reaches
  // this tab. tokens have their own realtime channel below; the counter's
  // own state doesn't, so this polls it directly: every 10s, and again
  // whenever the tab regains focus (the common case -- staff switch away,
  // an admin opens the desk, they switch back).
  const [deskState, setDeskState] = useState(counter.state)

  useEffect(() => {
    let cancelled = false
    async function refreshDeskState() {
      const { data } = await supabase.from("counters").select("state").eq("id", counter.id).single()
      if (!cancelled && data) setDeskState(data.state)
    }
    refreshDeskState()
    const id = setInterval(refreshDeskState, 10000)
    window.addEventListener("focus", refreshDeskState)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener("focus", refreshDeskState)
    }
  }, [counter.id, supabase])

  // One-second ticker for the "since call started" timer, only while there's
  // something to time.
  useEffect(() => {
    if (!current?.called_at) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first tick right after mount, see the `now` comment above for why it can't run during render
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [current?.called_at])

  const elapsedLabel = current?.called_at && now !== null
    ? formatElapsed(Math.max(0, Math.floor((now - new Date(current.called_at).getTime()) / 1000)))
    : "00:00"

  const run = useCallback(async (action: () => Promise<void>) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setBanner(null)
    try {
      await action()
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [])

  // Every mutation is an RPC in public.tokens' real state machine (see
  // supabase/migrations/0020_call_next.sql, 0021_token_lifecycle.sql):
  // call_next(p_counter) -> 'called', start_serving(p_token) -> 'serving',
  // complete_token(p_token) -> 'done', skip_token(p_token) -> 'skipped',
  // recall_token(p_token) re-rings a 'called' ticket. docs/DECISIONS.md
  // flagged this screen was still wired to non-existent mark_done/
  // mark_no_show/transfer_token with wrong param names (counter_id/token_id
  // instead of p_counter/p_token) -- fixed here. There is no staff-facing
  // no-show RPC (no-shows are set only by the automatic housekeeping job on
  // a timer), so "No-show" is now "Skip", and transfer isn't in the spec so
  // that control is removed rather than left calling a function that
  // doesn't exist.
  const callNext = useCallback(async () => {
    await run(async () => {
      const { data, error } = await supabase.rpc("call_next", { p_counter: counter.id })
      if (error) {
        setBanner({ kind: "error", text: mapSupabaseError(error) })
        return
      }
      // call_next is `returns setof tokens`, so PostgREST always hands back
      // an array -- empty, not null/undefined, when no one is waiting.
      const token = (data as TokenRow[] | null)?.[0] ?? null
      if (!token) {
        setBanner({ kind: "info", text: "No one waiting." })
        return
      }
      setCurrent(token)
    })
  }, [counter.id, run, supabase])

  // "Done" covers both remaining lifecycle steps: a ticket lands here as
  // 'called' (complete_token only accepts 'serving'), so this starts serving
  // first and then completes it as one staff action rather than exposing an
  // extra "start serving" click the display board never distinguishes.
  const markDone = useCallback(async () => {
    if (!current) return
    await run(async () => {
      if (current.status === "called") {
        const { error: startError } = await supabase.rpc("start_serving", { p_token: current.id })
        if (startError) {
          setBanner({ kind: "error", text: mapSupabaseError(startError) })
          return
        }
      }
      const { error } = await supabase.rpc("complete_token", { p_token: current.id })
      if (error) {
        setBanner({ kind: "error", text: mapSupabaseError(error) })
        return
      }
      setCurrent(null)
    })
  }, [current, run, supabase])

  const skip = useCallback(async () => {
    if (!current) return
    await run(async () => {
      const { error } = await supabase.rpc("skip_token", { p_token: current.id })
      if (error) {
        setBanner({ kind: "error", text: mapSupabaseError(error) })
        return
      }
      setCurrent(null)
    })
  }, [current, run, supabase])

  const recall = useCallback(async () => {
    if (!current) return
    const code = current.code
    await run(async () => {
      const { data, error } = await supabase.rpc("recall_token", { p_token: current.id })
      if (error) {
        setBanner({ kind: "error", text: mapSupabaseError(error) })
        return
      }
      setCurrent((data as TokenRow | null) ?? current)
      setBanner({ kind: "info", text: `Recalled ${code}.` })
    })
  }, [current, run, supabase])

  // Realtime: a second screen open on this same counter (a supervisor view, a
  // second tab) sees calls/done/no-show/recall/transfer without a refresh.
  // ponytail: this only reacts to updates where counter_id already equals (or
  // becomes) this counter -- a transfer OUT that a *different* client
  // initiates updates counter_id to the target, so this filter never matches
  // that specific row change, and this screen won't auto-clear from it. Not a
  // gap for the spec'd case (this desk's own actions always resolve locally
  // via the RPC's response, above); upgrade to a broader `service_id=eq.`
  // filter if cross-counter visibility into "my token got pulled away" turns
  // out to matter for the demo.
  const handleTokenEvent = useCallback((payload: { new?: TokenRow | null }) => {
    const row = payload?.new
    if (!row || !row.id) return
    setCurrent((prev) => {
      if (ACTIVE_TOKEN_STATUSES.includes(row.status)) return row
      if (prev && prev.id === row.id) return null
      return prev
    })
  }, [])

  useResilientChannel({
    channelName: `counter-${counter.id}-tokens`,
    table: "tokens",
    filter: `counter_id=eq.${counter.id}`,
    onEvent: handleTokenEvent,
  })

  // Keyboard shortcuts: N/D/S/R, ignored while typing in a field and while a
  // call is in flight (the `pending` lock inside `run` covers the actual
  // double-submit risk; this just avoids firing at all mid-request).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
      const el = document.activeElement as HTMLElement | null
      if (el && (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable)) {
        return
      }
      switch (event.key.toLowerCase()) {
        case "n":
          if (!current && deskState === "open") {
            event.preventDefault()
            void callNext()
          }
          break
        case "d":
          if (current) {
            event.preventDefault()
            void markDone()
          }
          break
        case "s":
          if (current) {
            event.preventDefault()
            void skip()
          }
          break
        case "r":
          if (current) {
            event.preventDefault()
            void recall()
          }
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [current, deskState, callNext, markDone, skip, recall])

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <h1 className={styles.counterName}>
            <span className={styles.counterKind}>Counter</span>{" "}
            <span translate="no">{counter.name}</span>
          </h1>
          <p className={styles.serviceLabel}>{serviceLabel}</p>
        </div>
        <div className={styles.staffBadge}>
          <span className={styles.staffName}>{staffName}</span>
          <span className={styles.stateBadge} data-state={deskState}>
            {deskState}
          </span>
        </div>
      </header>

      {!current ? (
        <div className={styles.idle}>
          <button
            type="button"
            className={styles.callNextButton}
            onClick={() => void callNext()}
            disabled={pending || deskState !== "open"}
            aria-keyshortcuts="N"
          >
            {pending ? "Calling…" : "Call Next"}
          </button>
          <p className={styles.idleHint}>
            {deskState !== "open" ? (
              "This desk is closed. Open it to call tokens."
            ) : (
              <>
                Press <kbd className={styles.kbd}>N</kbd> to call the next token.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className={styles.tokenCard}>
          <span className={styles.laneBadge} data-lane={current.lane}>
            {LANE_LABELS[current.lane]}
          </span>
          <p className={styles.tokenCode} translate="no">
            {current.code}
          </p>
          <p className={styles.tokenMeta}>
            {current.walk_in_label ?? "Registered patient"} · #{current.number}
            {current.recall_count > 0 ? ` · recalled ${current.recall_count}×` : ""}
          </p>
          <p className={styles.timer}>
            Called <span className={styles.timerValue}>{elapsedLabel}</span> ago
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionPrimary}
              onClick={() => void markDone()}
              disabled={pending}
              aria-keyshortcuts="D"
            >
              Done <kbd className={styles.kbd} aria-hidden="true">D</kbd>
            </button>
            <button
              type="button"
              className={styles.actionSecondary}
              onClick={() => void skip()}
              disabled={pending}
              aria-keyshortcuts="S"
            >
              Skip <kbd className={styles.kbd} aria-hidden="true">S</kbd>
            </button>
            <button
              type="button"
              className={styles.actionSecondary}
              onClick={() => void recall()}
              disabled={pending}
              aria-keyshortcuts="R"
            >
              Recall <kbd className={styles.kbd} aria-hidden="true">R</kbd>
            </button>
          </div>
        </div>
      )}

      {/* Messages sit under the card so they never push the buttons down
          mid-click. The status region stays mounted so screen readers announce
          each new message; errors mount their own role="alert", which is
          announced on insertion. */}
      {banner?.kind === "error" && (
        <p role="alert" className={styles.bannerError}>
          {banner.text}
        </p>
      )}
      <div role="status" className={styles.statusSlot}>
        {banner?.kind === "info" && <p className={styles.bannerInfo}>{banner.text}</p>}
      </div>
    </div>
  )
}
