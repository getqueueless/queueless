"use client"

import { useCallback, useState } from "react"

import { useResilientChannel } from "@/lib/realtime/useResilientChannel"
import { createClient } from "@/lib/supabase/client"

import styles from "../page.module.css"
import { loadBoard, type BoardStats } from "./board"

const supabase = createClient()

// Server-rendered first paint, then re-read on every board change -- the same
// two realtime tables the TV display listens to.
export function LiveStats({ initial }: { initial: BoardStats | null }) {
  const [stats, setStats] = useState(initial)

  const refresh = useCallback(() => {
    loadBoard(supabase).then((board) => {
      if (board) setStats(board.stats)
    })
  }, [])

  useResilientChannel({ channelName: "landing-board-services", table: "board_services", onEvent: refresh })
  useResilientChannel({ channelName: "landing-board-counters", table: "board_counters", onEvent: refresh })

  // A zero reads as a dead product next to "Live", so it gets words instead.
  // avgServiceMins is null until some service has a rolling average.
  const tiles = [
    { label: "Waiting now", value: stats?.waiting, zero: "No one" },
    { label: "Seen today", value: stats?.servedToday, zero: "None yet" },
    { label: "Counters open", value: stats?.countersOpen },
    { label: "Typical visit", value: stats?.avgServiceMins, unit: "min" },
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
            key={stats ? `${stats.waiting}-${stats.servedToday}-${stats.countersOpen}` : "off"}
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
