"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"

import styles from "../page.module.css"
import { loadBoard, type BoardStats } from "./board"

const supabase = createClient()

// Server-rendered first paint, then re-read every 10s and on returning to the
// tab. postgres_changes never fires on this stack (docs/API_CONTRACT.md,
// "Realtime topics"), so the old board_services/board_counters listeners
// here received nothing; the same poll caps staleness on /t/[id] and the TV.
export function LiveStats({ initial }: { initial: BoardStats | null }) {
  const [stats, setStats] = useState(initial)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      loadBoard(supabase).then((board) => {
        if (!cancelled && board) setStats(board.stats)
      })
    }
    const interval = setInterval(refresh, 10_000)
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  // A zero reads as a dead product next to "Live", so it gets words instead.
  // The wait is an estimate from the board (see estimateWaitMins) and says so;
  // null means no queue can be estimated yet.
  const tiles = [
    { label: "Seen today", value: stats?.servedToday, zero: "None yet" },
    { label: "Est. wait now", value: stats?.waitNowMins, unit: "min", zero: "No wait" },
    { label: "Counters open", value: stats?.countersOpen },
  ]

  return (
    <section aria-labelledby="now-title" className={styles.now}>
      <div>
        <h2 id="now-title" className={styles.nowTitle}>
          Right now
        </h2>
        <p className={stats ? styles.live : `${styles.live} ${styles.liveOff}`}>
          {/* Keyed on the numbers, so the dot pulses again each time they change. */}
          <span
            key={stats ? `${stats.servedToday}-${stats.waitNowMins}-${stats.countersOpen}` : "off"}
            className={styles.liveDot}
            aria-hidden="true"
          />
          {stats ? "Live from the queue" : "Live numbers are unavailable right now"}
        </p>
      </div>
      {/* No feed: the line above says so, instead of four blank tiles. */}
      {stats ? (
        <dl className={styles.stats}>
          {tiles.map((tile) => (
            <div key={tile.label} className={styles.stat}>
              <dt className={styles.statLabel}>{tile.label}</dt>
              <dd className={styles.statValue}>
                {tile.value == null ? (
                  <span className={styles.statWord}>Not yet</span>
                ) : tile.value === 0 && tile.zero ? (
                  <span className={styles.statWord}>{tile.zero}</span>
                ) : (
                  <>
                    {tile.value}
                    {tile.unit ? <span className={styles.statUnit}> {tile.unit}</span> : null}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
