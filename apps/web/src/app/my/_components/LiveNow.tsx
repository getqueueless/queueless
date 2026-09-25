"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"

import { countOpenCounters } from "@/app/t/[id]/data"
import { fetchPrediction } from "@/app/t/[id]/predict"
import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import { createClient } from "@/lib/supabase/client"

import type { Department } from "./data"
import styles from "./LiveNow.module.css"
import ui from "./ui.module.css"

// Poll as a floor under the broadcast; the broadcast is what makes it live.
const POLL_MS = 30_000

/** A number that counts to its new value (registered @property, CSS only). */
export function Tween({ value, className }: { value: number; className?: string }) {
  return (
    <>
      <span aria-hidden="true" className={`${styles.tween} ${className ?? ""}`} style={{ "--n": value } as CSSProperties} />
      <span className={ui.srOnly}>{value}</span>
    </>
  )
}

type Eta = { minutes: number; rough: boolean }

function DepartmentChip({ dept, day }: { dept: Department; day: string }) {
  const [supabase] = useState(() => createClient())
  const [waiting, setWaiting] = useState(dept.waiting)
  // undefined: still asking the model. null: no estimate to show.
  const [eta, setEta] = useState<Eta | null | undefined>(undefined)
  const predictedFor = useRef<number | null>(null)

  // Board row first (cheap, and what every broadcast changes); the model is
  // only asked again when the line length actually moved.
  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("board_services")
      .select("waiting_count")
      .eq("service_id", dept.id)
      .eq("day", day)
      .maybeSingle()
    if (error) return
    const n = (data as { waiting_count: number } | null)?.waiting_count ?? 0
    setWaiting(n)
    if (predictedFor.current === n) return
    predictedFor.current = n
    const prediction = await fetchPrediction(dept.id, n, await countOpenCounters(supabase, dept.id))
    setEta(prediction ? { minutes: Math.max(0, Math.round(prediction.predictedWaitMinutes)), rough: prediction.fallback } : null)
  }, [supabase, dept.id, day])

  useResilientChannel({ channelName: `service:${dept.id}`, broadcastEvent: "token_update", onEvent: load })

  useEffect(() => {
    // Deferred a tick so the first read is not a setState inside the effect body.
    const first = setTimeout(load, 0)
    const timer = setInterval(load, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load])

  return (
    <li className={styles.chip}>
      <div className={styles.name}>
        <span className={styles.code} translate="no">
          {dept.code}
        </span>
        <span>{dept.name}</span>
      </div>
      <dl className={styles.figures}>
        <div>
          <dt className={styles.label}>Waiting</dt>
          <dd className={styles.value}>
            <Tween value={waiting} />
          </dd>
        </div>
        <div>
          <dt className={styles.label}>{eta?.rough ? "Rough wait" : "Est. wait"}</dt>
          <dd className={styles.value}>
            {eta === undefined ? (
              <span className={`${ui.skel} ${styles.skelValue}`} />
            ) : eta === null ? (
              <span className={styles.none}>No estimate</span>
            ) : (
              <>
                <span aria-hidden="true">~</span>
                <Tween value={eta.minutes} />
                <span className={styles.unit}> min</span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </li>
  )
}

export function LiveNow({ departments, day }: { departments: Department[]; day: string }) {
  if (departments.length === 0) {
    return <p className={styles.empty}>No department is open right now.</p>
  }
  return (
    <ul className={styles.strip}>
      {departments.map((d) => (
        <DepartmentChip key={d.id} dept={d} day={day} />
      ))}
    </ul>
  )
}

export function LiveNowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status">
      <span className={ui.srOnly}>Loading live queue numbers</span>
      <ul className={styles.strip} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className={styles.chip}>
            <span className={`${ui.skel} ${styles.skelName}`} />
            <span className={`${ui.skel} ${styles.skelFigures}`} />
          </li>
        ))}
      </ul>
    </div>
  )
}
