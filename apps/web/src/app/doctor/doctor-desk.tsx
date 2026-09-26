"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import { createClient } from "@/lib/supabase/client"
import { ACTIVE_TOKEN_STATUSES, type CounterRow, type Lane, type TokenRow } from "../counter/types"
import styles from "./doctor.module.css"

export type DeskInfo = {
  counter: CounterRow
  serviceIds: string[]
  serviceLabel: string
  doctor: { id: string; name: string; room: string | null; specialty: string } | null
  /** "self": the signed-in doctor's own desk; "admin": an admin running a picked doctor's desk. */
  mode: "self" | "admin"
}

type Waiting = Pick<TokenRow, "id" | "code" | "lane" | "walk_in_label"> & { created_at: string }
type Stats = { seen: number; avgMins: number | null; waiting: number }

const LANE_LABELS: Record<Lane, string> = {
  emergency: "Emergency",
  senior: "Senior",
  pregnant: "Pregnant",
  appointment: "Appointment",
  normal: "Walk-in",
}

const TOKEN_COLUMNS =
  "id, org_id, service_id, service_day, number, code, lane, status, patient_id, walk_in_label, counter_id, recall_count, called_at, serving_at"

function errorText(error: { code?: string; message?: string } | null | undefined) {
  return error?.message || "That didn’t go through. Try again."
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

// Same RPCs as /counter (call_next pulls only this doctor's tokens when the
// counter is doctor-bound, migration 0039). Live from the service broadcast
// (migration 0044) plus a 10s poll, so it never needs a reload.
export function DoctorDesk({ desk, initialToken }: { desk: DeskInfo; initialToken: TokenRow | null }) {
  const supabase = useMemo(() => createClient(), [])
  const { counter, doctor } = desk
  const [current, setCurrent] = useState<TokenRow | null>(initialToken)
  const [patientName, setPatientName] = useState<string | null>(null)
  const [deskState, setDeskState] = useState(counter.state)
  const [upNext, setUpNext] = useState<Waiting[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [banner, setBanner] = useState<{ kind: "error" | "info"; text: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  const pendingRef = useRef(false)

  const refresh = useCallback(async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())
    let waitingQuery = supabase
      .from("tokens")
      .select("id, code, lane, walk_in_label, created_at")
      .in("service_id", desk.serviceIds.length ? desk.serviceIds : ["00000000-0000-0000-0000-000000000000"])
      .eq("service_day", today)
      .eq("status", "waiting")
      .order("lane_rank", { ascending: true })
      .order("priority_at", { ascending: true })
      .order("number", { ascending: true })
    if (doctor) waitingQuery = waitingQuery.eq("doctor_id", doctor.id)

    const [cur, state, waiting, done] = await Promise.all([
      supabase.from("tokens").select(TOKEN_COLUMNS).eq("counter_id", counter.id).in("status", ACTIVE_TOKEN_STATUSES).limit(1).maybeSingle(),
      supabase.from("counters").select("state").eq("id", counter.id).single(),
      waitingQuery,
      supabase
        .from("tokens")
        .select("serving_at, finished_at")
        .eq("counter_id", counter.id)
        .eq("service_day", today)
        .eq("status", "done"),
    ])
    if (!cur.error) setCurrent((cur.data as TokenRow | null) ?? null)
    if (state.data) setDeskState(state.data.state)
    const list = (waiting.data ?? []) as Waiting[]
    setUpNext(list.slice(0, 5))
    const doneRows = (done.data ?? []) as { serving_at: string | null; finished_at: string | null }[]
    const durations = doneRows
      .filter((r) => r.serving_at && r.finished_at)
      .map((r) => (new Date(r.finished_at!).getTime() - new Date(r.serving_at!).getTime()) / 60000)
      .filter((m) => m > 0 && m < 120)
    setStats({
      seen: doneRows.length,
      avgMins: durations.length ? Math.max(1, Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)) : null,
      waiting: list.length,
    })
  }, [supabase, counter.id, desk.serviceIds, doctor])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load, then the same poll
    void refresh()
    const id = setInterval(refresh, 10_000)
    window.addEventListener("focus", refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener("focus", refresh)
    }
  }, [refresh])

  useResilientChannel({
    channelName: `service:${desk.serviceIds[0] ?? "none"}`,
    broadcastEvent: "token_update",
    onEvent: refresh,
  })

  // The patient's name, when RLS lets staff read it; walk-ins keep their label.
  useEffect(() => {
    if (!current?.patient_id) return
    let cancelled = false
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", current.patient_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPatientName((data as { full_name: string | null } | null)?.full_name ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [current?.patient_id, supabase])

  useEffect(() => {
    if (!current?.called_at) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the ticker's first tick after mount
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [current?.called_at])

  const run = useCallback(
    async (action: () => Promise<{ error: { message?: string } | null } | void>) => {
      if (pendingRef.current) return
      pendingRef.current = true
      setPending(true)
      setBanner(null)
      try {
        const result = await action()
        if (result && result.error) setBanner({ kind: "error", text: errorText(result.error) })
        await refresh()
      } finally {
        pendingRef.current = false
        setPending(false)
      }
    },
    [refresh],
  )

  const next = useCallback(
    () =>
      run(async () => {
        const { data, error } = await supabase.rpc("call_next", { p_counter: counter.id })
        if (!error && !(data as TokenRow[] | null)?.length) setBanner({ kind: "info", text: "No one waiting." })
        return { error }
      }),
    [run, supabase, counter.id],
  )
  const start = useCallback(
    () => current && run(async () => supabase.rpc("start_serving", { p_token: current.id })),
    [run, supabase, current],
  )
  const done = useCallback(
    () =>
      current &&
      run(async () => {
        if (current.status === "called") {
          const started = await supabase.rpc("start_serving", { p_token: current.id })
          if (started.error) return started
        }
        return supabase.rpc("complete_token", { p_token: current.id })
      }),
    [run, supabase, current],
  )
  const skip = useCallback(() => {
    if (!current) return
    if (!window.confirm(`Mark ${current.code} as not here and move on?`)) return
    return run(async () => supabase.rpc("skip_token", { p_token: current.id }))
  }, [run, supabase, current])
  const recall = useCallback(
    () => current && run(async () => supabase.rpc("recall_token", { p_token: current.id })),
    [run, supabase, current],
  )
  const toggleDesk = useCallback(() => {
    const nextState = deskState === "open" ? "closed" : "open"
    if (nextState === "closed" && !window.confirm("Close this desk? No one new will be called here.")) return
    return run(async () => supabase.rpc("set_counter_state", { p_counter: counter.id, p_state: nextState }))
  }, [run, supabase, counter.id, deskState])
  const setStatus = useCallback(
    (status: "available" | "running_late" | "on_break", late?: number) =>
      doctor &&
      run(async () => {
        const res =
          desk.mode === "self"
            ? await supabase.rpc("set_my_doctor_status", { p_status: status, p_late_minutes: late ?? null })
            : await supabase.rpc("set_doctor_status", { p_doctor: doctor.id, p_status: status, p_late_minutes: late ?? null })
        if (!res.error)
          setBanner({
            kind: "info",
            text: status === "available" ? "Marked back." : status === "on_break" ? "Marked on break." : `Marked running ${late} min late.`,
          })
        return res
      }),
    [run, supabase, doctor, desk.mode],
  )

  // N next, S start, D done, K skip, R recall. Ignored while typing or mid-request.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || pendingRef.current) return
      const el = document.activeElement as HTMLElement | null
      if (el && (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable)) return
      const key = event.key.toLowerCase()
      if (key === "n" && !current && deskState === "open") void next()
      else if (key === "s" && current?.status === "called") void start()
      else if (key === "d" && current) void done()
      else if (key === "k" && current) void skip()
      else if (key === "r" && current?.status === "called") void recall()
      else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [current, deskState, next, start, done, skip, recall])

  const elapsed = current?.called_at && now !== null ? clock((now - new Date(current.called_at).getTime()) / 1000) : "00:00"
  const who = current ? (current.walk_in_label ?? patientName ?? "Registered patient") : null

  return (
    <div className={styles.desk}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>
            {doctor ? doctor.name : `Counter ${counter.name}`}
          </h1>
          <p className={styles.sub}>
            {doctor ? [doctor.specialty, doctor.room ? `Room ${doctor.room}` : null, `Counter ${counter.name}`].filter(Boolean).join(" · ") : desk.serviceLabel}
          </p>
        </div>
        <button type="button" className={styles.deskToggle} data-state={deskState} onClick={() => void toggleDesk()} disabled={pending}>
          <span className={styles.dot} aria-hidden="true" />
          Desk {deskState === "open" ? "open" : deskState}
          <span className={styles.toggleHint}>{deskState === "open" ? "Close" : "Open"}</span>
        </button>
      </header>

      <div className={styles.grid}>
        <section aria-labelledby="now-heading" className={styles.nowCard} data-status={current?.status ?? "idle"}>
          <h2 id="now-heading" className={styles.label}>
            {current ? (current.status === "serving" ? "With the doctor" : "Called") : "No patient at the desk"}
          </h2>
          {current ? (
            <>
              <p className={styles.code} translate="no">
                {current.code}
              </p>
              <p className={styles.who}>
                {who}
                <span className={styles.lane} data-lane={current.lane}>
                  {LANE_LABELS[current.lane]}
                </span>
              </p>
              <p className={styles.meta}>
                Called <strong className={styles.timer}>{elapsed}</strong> ago
                {current.recall_count > 0 ? ` · recalled ${current.recall_count}×` : ""}
              </p>
              <a href={`/slip/${current.id}`} target="_blank" rel="noopener" className={styles.slipLink}>
                Print OPD slip
              </a>
            </>
          ) : (
            <p className={styles.idle}>
              {deskState === "open" ? (
                <>
                  Press <kbd>N</kbd> or Next patient to call the next token.
                </>
              ) : (
                "This desk is closed. Open it to call patients."
              )}
            </p>
          )}

          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => void next()} disabled={pending || !!current || deskState !== "open"} aria-keyshortcuts="N">
              Next patient <kbd>N</kbd>
            </button>
            <button type="button" className={styles.secondary} onClick={() => void start()} disabled={pending || current?.status !== "called"} aria-keyshortcuts="S">
              Start <kbd>S</kbd>
            </button>
            <button type="button" className={styles.secondary} onClick={() => void done()} disabled={pending || !current} aria-keyshortcuts="D">
              Done <kbd>D</kbd>
            </button>
            <button type="button" className={styles.secondary} onClick={() => void recall()} disabled={pending || current?.status !== "called"} aria-keyshortcuts="R">
              Recall <kbd>R</kbd>
            </button>
            <button type="button" className={styles.danger} onClick={() => void skip()} disabled={pending || !current} aria-keyshortcuts="K">
              No-show / skip <kbd>K</kbd>
            </button>
          </div>
          {banner?.kind === "error" && (
            <p role="alert" className={styles.error}>
              {banner.text}
            </p>
          )}
          <p role="status" className={styles.info}>
            {banner?.kind === "info" ? banner.text : ""}
          </p>
        </section>

        <aside className={styles.side}>
          <section aria-labelledby="today-heading" className={styles.panel}>
            <h2 id="today-heading" className={styles.label}>
              Today
            </h2>
            <dl className={styles.stats}>
              <div>
                <dt>Seen</dt>
                <dd>{stats ? stats.seen : "–"}</dd>
              </div>
              <div>
                <dt>Avg consult</dt>
                <dd>{stats?.avgMins != null ? `${stats.avgMins} min` : "–"}</dd>
              </div>
              <div>
                <dt>Waiting</dt>
                <dd>{stats ? stats.waiting : "–"}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="next-heading" className={styles.panel}>
            <h2 id="next-heading" className={styles.label}>
              Up next
            </h2>
            {upNext.length === 0 ? (
              <p className={styles.empty}>No one waiting.</p>
            ) : (
              <ol className={styles.queue}>
                {upNext.map((t) => (
                  <li key={t.id}>
                    <span className={styles.queueCode} translate="no">
                      {t.code}
                    </span>
                    <span className={styles.queueWho}>{t.walk_in_label ?? "Registered patient"}</span>
                    {t.lane !== "normal" && (
                      <span className={styles.lane} data-lane={t.lane}>
                        {LANE_LABELS[t.lane]}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {doctor && (
            <section aria-labelledby="status-heading" className={styles.panel}>
              <h2 id="status-heading" className={styles.label}>
                Doctor status
              </h2>
              <div className={styles.statusButtons}>
                {[10, 20, 30].map((m) => (
                  <button key={m} type="button" className={styles.chip} onClick={() => void setStatus("running_late", m)} disabled={pending}>
                    Late {m} min
                  </button>
                ))}
                <button type="button" className={styles.chip} onClick={() => void setStatus("on_break")} disabled={pending}>
                  On break
                </button>
                <button type="button" className={styles.chip} onClick={() => void setStatus("available")} disabled={pending}>
                  Back
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
