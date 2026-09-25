"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { LogoMark } from "@/components/brand/Logo"
import { createClient } from "@/lib/supabase/client"
import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import { announce, hasVoiceFor, unlockSpeech } from "@/lib/speech/announce"
import { DOCTOR_STATUS_LABEL, listDoctorsForService, type Doctor } from "@/lib/doctors"
import { fetchTranslation } from "./translate"
import styles from "./display.module.css"

// Real schema (supabase/migrations/0006_boards_notifications_audit.sql) -- these two
// board_* tables are exactly what a public TV board is meant to read (see
// supabase/README.md's own sample: anon can read board_services/board_counters, nothing
// else). `services`/`counters` themselves are documented as signed-in-only, so this page
// never depends on them for anything the board needs to function.
type BoardService = {
  service_id: string
  waiting_count: number
  served_count: number
  no_show_count: number
  last_called_code: string | null
  avg_service_secs: number | null
}

type CounterState = "open" | "paused" | "closed"

type BoardCounter = {
  counter_id: string
  counter_name: string
  state: CounterState
  token_code: string | null
  token_status: string | null
}

const supabase = createClient()

// Announcement voice. "en" speaks the plain English string as before; "hi"/
// "pa" are sent to POST /translate first (see ./translate.ts) and only used
// if that succeeds AND the browser actually has a matching voice --
// otherwise every path falls back to English, never silence.
type Language = "en" | "hi" | "pa"
const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "hi", label: "HI" },
  { value: "pa", label: "PA" },
]
const VOICE_TAG: Record<Language, string> = { en: "en-IN", hi: "hi-IN", pa: "pa-IN" }

// ponytail: "next up" has no anon-safe source (tokens rows are patient-scoped by design --
// see supabase/README.md's grant matrix -- and board_services only has a waiting COUNT, not
// the list). We extrapolate forward from the last called number. Ceiling: wrong the moment
// priority lanes/no-shows reorder the real queue. Real fix is a DB-agent view/RPC that
// exposes just the next N codes (no patient_id/walk_in_label) to anon.
function nextUpCodes(lastCalledCode: string | null, waitingCount: number, max = 5): string[] {
  if (!lastCalledCode || waitingCount <= 0) return []
  const dash = lastCalledCode.lastIndexOf("-")
  if (dash < 0) return []
  const prefix = lastCalledCode.slice(0, dash)
  const digits = lastCalledCode.slice(dash + 1)
  const start = Number.parseInt(digits, 10)
  if (!Number.isFinite(start)) return []
  const count = Math.min(waitingCount, max)
  return Array.from({ length: count }, (_, i) =>
    `${prefix}-${String(start + i + 1).padStart(digits.length, "0")}`,
  )
}

function announcementText(tokenCode: string, counterName: string): string {
  const dash = tokenCode.lastIndexOf("-")
  const serviceCode = dash >= 0 ? tokenCode.slice(0, dash) : tokenCode
  const number = dash >= 0 ? Number.parseInt(tokenCode.slice(dash + 1), 10) : NaN
  const counterNumber = counterName.match(/\d+/)?.[0] ?? counterName
  const numberText = Number.isFinite(number) ? String(number).padStart(3, "0") : tokenCode.slice(dash + 1)
  return `Token ${serviceCode}-${numberText}, counter ${counterNumber}`
}

export function DisplayBoard({ serviceId }: { serviceId: string }) {
  const [label, setLabel] = useState("Queue Display")
  const [serviceCode, setServiceCode] = useState<string | null>(null)
  const [board, setBoard] = useState<BoardService | null>(null)
  const [counters, setCounters] = useState<BoardCounter[]>([])
  const [soundEnabled, setSoundEnabled] = useState(false)
  // Kiosk-local only: this is a fixed public screen, not a visitor's own
  // device, so there is no per-viewer preference to remember across sessions.
  const [language, setLanguage] = useState<Language>("en")
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const chimeRef = useRef<HTMLAudioElement | null>(null)
  // counter_id -> token_code already voiced, so a reconnect/unrelated update never repeats
  // (or, before sound is unlocked, never queues up) an announcement for an old call.
  const announcedRef = useRef<Map<string, string>>(new Map())
  // Counters this service's counter_services rows point at (QA #9: this board's "Now
  // serving" grid was showing every counter hospital-wide, not just this department's).
  // null means "scope unknown yet or query failed" -- loadCounters falls back to the
  // unscoped list rather than going blank.
  const counterIdsRef = useRef<string[] | null>(null)

  // Translate (if a non-English language is selected) then speak, in that order --
  // moved above loadCounters (which now calls this directly, see its own comment) so
  // it's declared before its first use. Any failure -- no API base configured, the
  // request errors/times out, or the target language has no matching browser voice --
  // falls back to the plain English line rather than saying nothing.
  async function resolveAnnouncement(englishText: string, lang: Language): Promise<{ text: string; tag: string }> {
    if (lang === "en") return { text: englishText, tag: VOICE_TAG.en }
    const translated = await fetchTranslation(englishText, lang)
    if (translated && hasVoiceFor(VOICE_TAG[lang])) return { text: translated, tag: VOICE_TAG[lang] }
    return { text: englishText, tag: VOICE_TAG.en }
  }

  function playThenAnnounce(englishText: string, lang: Language) {
    const speak = () => {
      resolveAnnouncement(englishText, lang).then(({ text, tag }) => announce(text, tag))
    }
    const audio = chimeRef.current
    if (!audio) {
      speak()
      return
    }
    audio.currentTime = 0
    audio.onended = speak
    audio.play().catch(speak)
  }

  const loadBoardService = useCallback(async () => {
    const { data } = await supabase
      .from("board_services")
      .select("service_id, waiting_count, served_count, no_show_count, last_called_code, avg_service_secs")
      .eq("service_id", serviceId)
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle()
    setBoard((data as BoardService | null) ?? null)
  }, [serviceId])

  // Also owns the "newly called, not yet announced" check (moved in from the old
  // postgres_changes handler): the token:<id>/service:<id> broadcast (migration 0044,
  // docs/API_CONTRACT.md) only signals "something changed for this service", not which
  // counter or what changed, so every consumer of a change (broadcast, the 10s poll)
  // has to re-fetch and diff against announcedRef itself rather than reading it off an
  // event payload. The init effect below fetches board_counters directly (not through
  // here) so its first-paint seed of announcedRef stays silent, as before.
  const loadCounters = useCallback(async () => {
    let query = supabase
      .from("board_counters")
      .select("counter_id, counter_name, state, token_code, token_status")
      .order("counter_name", { ascending: true })
    if (counterIdsRef.current && counterIdsRef.current.length > 0) {
      query = query.in("counter_id", counterIdsRef.current)
    }
    const { data } = await query
    const rows = (data as BoardCounter[] | null) ?? []
    setCounters(rows)
    for (const row of rows) {
      if (!row.token_code || row.token_status !== "called") continue
      if (announcedRef.current.get(row.counter_id) === row.token_code) continue
      announcedRef.current.set(row.counter_id, row.token_code)
      if (!soundEnabled || !serviceCode || !row.token_code.startsWith(`${serviceCode}-`)) continue
      playThenAnnounce(announcementText(row.token_code, row.counter_name), language)
    }
    return rows
  }, [soundEnabled, serviceCode, language])

  // Best-effort label + code for voice scoping. `services` is documented as signed-in-only
  // (supabase/README.md), so anon access here is expected to eventually fail once RLS
  // policies land -- it still works today because no RLS is on any table yet. On failure we
  // fall back to a generic label and simply never announce (safer than guessing which calls
  // belong to this service), see the report for the dependency this leaves on the DB agent.
  useEffect(() => {
    let cancelled = false
    supabase
      .from("services")
      .select("name, code")
      .eq("id", serviceId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const row = data as { name: string; code: string }
        setLabel(row.name)
        setServiceCode(row.code)
      })
    return () => {
      cancelled = true
    }
  }, [serviceId])

  // Initial load, inline for board_services (loadBoardService/loadCounters below exist for
  // the realtime handlers to re-run). Fetches board_services, counter_services (this
  // service's own counter_ids, for QA #9) and the unscoped board_counters all in ONE
  // parallel round-trip, then filters client-side -- awaiting counter_services first
  // before even starting the board_counters fetch was measurably slower on prod (an extra
  // serial round-trip flashed "No counters open yet." on every cold load, confirmed live),
  // so scoping happens after the fetch here instead of before it. Later re-fetches
  // (realtime handlers, the poll below) go through loadCounters(), which by then has
  // counterIdsRef populated and scopes server-side via `.in(...)`. Seeds `announcedRef`
  // from whatever's already on the board so an unrelated change to an already-serving
  // counter never fires a stale announcement on first render.
  useEffect(() => {
    let cancelled = false
    async function init() {
      const [boardRes, csRes, countersRes] = await Promise.all([
        supabase
          .from("board_services")
          .select("service_id, waiting_count, served_count, no_show_count, last_called_code, avg_service_secs")
          .eq("service_id", serviceId)
          .order("day", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("counter_services").select("counter_id").eq("service_id", serviceId),
        supabase
          .from("board_counters")
          .select("counter_id, counter_name, state, token_code, token_status")
          .order("counter_name", { ascending: true }),
      ])
      if (cancelled) return
      counterIdsRef.current =
        csRes.data && csRes.data.length > 0 ? csRes.data.map((r) => r.counter_id as string) : null
      setBoard((boardRes.data as BoardService | null) ?? null)
      const allRows = (countersRes.data as BoardCounter[] | null) ?? []
      const rows = counterIdsRef.current
        ? allRows.filter((r) => counterIdsRef.current!.includes(r.counter_id))
        : allRows
      setCounters(rows)
      for (const row of rows) {
        if (row.token_code) announcedRef.current.set(row.counter_id, row.token_code)
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [serviceId])

  // Doctor status strip. There is no doctor-per-token path in this schema
  // (tokens has service_id + counter_id only, no doctor_id -- see
  // supabase/migrations/0004_tokens.sql / 0003_services_counters.sql), so
  // this is deliberately service-wide, not tied to any called token. Reuses
  // the doctors/doctor_status_today read that already powers the booking UI
  // (src/lib/doctors.ts) -- both are public-read.
  // ponytail: plain 60s poll, not a realtime channel -- a doctor's status
  // changes on its own clock (stepping out, coming back), not on every queue
  // event, so a third resilient channel isn't worth it here. Upgrade if a
  // status flip needs to show in under a minute.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      listDoctorsForService(supabase, serviceId).then((rows) => {
        if (!cancelled) setDoctors(rows)
      })
    }
    load()
    const id = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [serviceId])

  // docs/API_CONTRACT.md "Realtime topics" (migration 0044): the DB only broadcasts a
  // token:<id> topic (per-patient) and a service:<id> topic (per-service) -- there is no
  // separate board_counters broadcast, and the payload deliberately carries none of
  // counter_name/token_code/token_status. So this is a pure "something changed for this
  // service, go re-fetch" signal: any token_update on service:<serviceId> re-runs both
  // loadBoardService and loadCounters (which now also owns the announce-on-newly-called
  // check, since there's no per-counter payload to read that off of any more).
  const onServiceUpdate = useCallback(() => {
    loadBoardService()
    loadCounters()
  }, [loadBoardService, loadCounters])

  useResilientChannel({
    channelName: `service:${serviceId}`,
    broadcastEvent: "token_update",
    onEvent: onServiceUpdate,
  })

  // Fallback for QA #1 -- same reasoning as t/[id]/status-view.tsx: a 10s poll plus a
  // refetch on tab focus caps staleness even if postgres_changes goes quiet on an
  // already-open tab. loadBoardService/loadCounters are already idempotent GETs, safe to
  // call on a timer.
  useEffect(() => {
    const refetch = () => {
      loadBoardService()
      loadCounters()
    }
    const interval = setInterval(refetch, 10_000)
    const handleVisible = () => {
      if (document.visibilityState === "visible") refetch()
    }
    document.addEventListener("visibilitychange", handleVisible)
    window.addEventListener("focus", refetch)
    return () => {
      clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisible)
      window.removeEventListener("focus", refetch)
    }
  }, [loadBoardService, loadCounters])

  function handleEnableSound() {
    unlockSpeech()
    setSoundEnabled(true)
  }

  const upcoming = useMemo(
    () => (board ? nextUpCodes(board.last_called_code, board.waiting_count) : []),
    [board],
  )

  const sortedCounters = useMemo(() => {
    const rank = (c: BoardCounter) => (c.state !== "open" ? 2 : c.token_code ? 0 : 1)
    return [...counters].sort((a, b) => rank(a) - rank(b) || a.counter_name.localeCompare(b.counter_name))
  }, [counters])

  // data-surface="slate": opts the board into the on-slate focus ring once
  // globals.css carries that rule (the module pins it locally until then).
  return (
    <main className={styles.page} data-surface="slate">
      <audio ref={chimeRef} src="/sounds/chime.wav" preload="auto" />

      {/* Fixed kiosk control, not a per-visitor preference -- sits behind the
          unlock overlay (lower z-index) until sound is enabled, same as the
          rest of the board. */}
      <div className={styles.langSelector} role="group" aria-label="Announcement language">
        {LANGUAGES.map((option) => (
          <button
            key={option.value}
            type="button"
            className={styles.langButton}
            aria-pressed={language === option.value}
            onClick={() => setLanguage(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!soundEnabled && (
        <button type="button" className={styles.unlockOverlay} onClick={handleEnableSound}>
          Tap anywhere to enable sound
        </button>
      )}

      <header className={styles.header}>
        <p className={styles.brand} translate="no">
          <LogoMark className={styles.brandMark} />
          Queueless
        </p>
        <h1 className={styles.title}>{label}</h1>
        {/* A value not known yet renders empty; the module draws the placeholder bar. */}
        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>Waiting</dt>
            <dd>{board?.waiting_count}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Served today</dt>
            <dd>{board?.served_count}</dd>
          </div>
          <div className={styles.stat}>
            <dt>Avg. time</dt>
            <dd>{board?.avg_service_secs ? `${Math.round(board.avg_service_secs / 60)} min` : null}</dd>
          </div>
        </dl>
      </header>

      <section className={styles.counters} aria-labelledby="board-now-serving" aria-live="polite">
        <h2 id="board-now-serving" className={styles.sectionTitle}>Now serving</h2>
        {sortedCounters.length === 0 && <p className={styles.empty}>No counters open yet.</p>}
        {/* Token first in mono, then the counter in sentence-case Poppins, so
            "OPD-014" never reads against a same-shaped "OPD-1" above it. The key
            carries the token so each new call remounts the tile and replays the
            call ring. */}
        {sortedCounters.map((c) => (
          <div
            key={`${c.counter_id}:${c.token_code ?? ""}`}
            className={styles.counterTile}
            data-state={c.state}
            data-status={c.token_status ?? undefined}
          >
            {/* No token: left empty, the module draws the placeholder bar and a
                paused or closed counter says so in its status chip. */}
            <p className={styles.tokenNumber} translate="no">
              {c.token_code}
            </p>
            <p className={styles.counterName}>
              {/^counter\b/i.test(c.counter_name) ? null : "Counter "}
              <span translate="no">{c.counter_name}</span>
            </p>
          </div>
        ))}
      </section>

      {upcoming.length > 0 && (
        <section className={styles.nextUp} aria-labelledby="board-next-up">
          <h2 id="board-next-up" className={styles.nextUpTitle}>Next up</h2>
          <ol className={styles.nextUpList} translate="no">
            {upcoming.map((token) => (
              <li key={token}>{token}</li>
            ))}
          </ol>
        </section>
      )}

      {/* Service-wide, not per-token: see the doctors effect above for why
          a called token can't be tied to a specific doctor in this schema. */}
      {doctors.length > 0 && (
        <section className={styles.doctors} aria-labelledby="board-doctors">
          <h2 id="board-doctors" className={styles.nextUpTitle}>Doctors</h2>
          <ul className={styles.doctorList}>
            {doctors.map((d) => (
              <li key={d.id} className={styles.doctorChip} data-status={d.status}>
                <span className={styles.doctorName} translate="no">{d.name}</span>
                <span className={styles.doctorStatus}>{DOCTOR_STATUS_LABEL[d.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
