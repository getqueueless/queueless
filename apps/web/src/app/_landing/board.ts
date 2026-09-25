import type { SupabaseClient } from "@supabase/supabase-js"

// Landing-page numbers, read from the same anon-readable board tables the TV
// display uses (display-board.tsx). No token rows, so nothing here can
// identify a patient.

export type BoardStats = {
  waiting: number
  servedToday: number
  countersOpen: number
  /** Mean of each service's rolling average, in whole minutes; null if no service has one. */
  avgServiceMins: number | null
}

export type Board = {
  stats: BoardStats
  /** Latest rolling average per service, for the service cards. */
  avgSecsByService: Record<string, number>
  /** Today's waiting count per service; a service with no row today has nobody waiting. */
  waitingByService: Record<string, number>
}

type BoardServiceRow = {
  service_id: string
  day: string
  waiting_count: number
  served_count: number
  avg_service_secs: number | null
}

export async function loadBoard(supabase: SupabaseClient): Promise<Board | null> {
  try {
    const [services, counters, org] = await Promise.all([
      supabase
        .from("board_services")
        .select("service_id, day, waiting_count, served_count, avg_service_secs")
        .order("day", { ascending: false })
        .limit(100),
      supabase.from("board_counters").select("state"),
      supabase.from("organizations").select("timezone").limit(1).maybeSingle(),
    ])
    if (services.error || counters.error) return null

    // Board rows are per service per service-day, and the service day is the
    // org's local date (private.service_day). No row for today means nobody
    // has taken a token yet today, so today's counts are genuinely zero.
    const timeZone = (org.data as { timezone?: string } | null)?.timezone ?? "Asia/Kolkata"
    const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date())

    const rows = (services.data ?? []) as BoardServiceRow[]
    const avgSecsByService: Record<string, number> = {}
    const waitingByService: Record<string, number> = {}
    let waiting = 0
    let servedToday = 0
    for (const row of rows) {
      if (row.day === today) {
        waiting += row.waiting_count
        servedToday += row.served_count
        waitingByService[row.service_id] = row.waiting_count
      }
      // Rows come newest day first, so the first one seen per service is its latest.
      if (row.avg_service_secs != null && !(row.service_id in avgSecsByService)) {
        avgSecsByService[row.service_id] = row.avg_service_secs
      }
    }

    const avgs = Object.values(avgSecsByService)
    const avgServiceMins = avgs.length
      ? Math.max(1, Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length / 60))
      : null
    const countersOpen = ((counters.data ?? []) as { state: string }[]).filter(
      (c) => c.state === "open",
    ).length

    return {
      stats: { waiting, servedToday, countersOpen, avgServiceMins },
      avgSecsByService,
      waitingByService,
    }
  } catch {
    return null
  }
}
