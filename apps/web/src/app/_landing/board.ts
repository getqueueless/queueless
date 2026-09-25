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
  /** Estimated wait for someone joining now, in whole minutes (see estimateWaitMins). */
  waitNowMins: number | null
}

export type Board = {
  /** The demo hospital's organizations.id; the page scopes its service list to it. */
  orgId: string | null
  stats: BoardStats
  /** Latest rolling average per service, for the service cards. */
  avgSecsByService: Record<string, number>
  /** Today's waiting count per service; a service with no row today has nobody waiting. */
  waitingByService: Record<string, number>
}

// ponytail: one public org per deployment (the demo preset). Other orgs on
// the same database (the load-test org) must never reach these numbers.
// Make this an env var if a second real org ever shares the site.
const ORG_SLUG = "city-hospital"

type BoardServiceRow = {
  service_id: string
  org_id: string
  day: string
  waiting_count: number
  served_count: number
  avg_service_secs: number | null
}

export async function loadBoard(supabase: SupabaseClient): Promise<Board | null> {
  try {
    const [services, counters, links, org] = await Promise.all([
      supabase
        .from("board_services")
        .select("service_id, org_id, day, waiting_count, served_count, avg_service_secs")
        .order("day", { ascending: false })
        .limit(100),
      supabase.from("board_counters").select("counter_id, org_id, state"),
      supabase.from("counter_services").select("counter_id, service_id"),
      supabase.from("organizations").select("id, timezone").eq("slug", ORG_SLUG).maybeSingle(),
    ])
    if (services.error || counters.error) return null

    // Board rows are per service per service-day, and the service day is the
    // org's local date (private.service_day). No row for today means nobody
    // has taken a token yet today, so today's counts are genuinely zero.
    const orgRow = org.data as { id: string; timezone: string } | null
    const orgId = orgRow?.id ?? null
    const timeZone = orgRow?.timezone ?? "Asia/Kolkata"
    const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date())

    const rows = ((services.data ?? []) as BoardServiceRow[]).filter((row) => !orgId || row.org_id === orgId)
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
    const counterRows = ((counters.data ?? []) as { counter_id: string; org_id: string; state: string }[]).filter(
      (c) => !orgId || c.org_id === orgId,
    )
    const openIds = new Set(counterRows.filter((c) => c.state === "open").map((c) => c.counter_id))
    const countersOpen = openIds.size
    const openByService: Record<string, number> = {}
    for (const link of (links.data ?? []) as { counter_id: string; service_id: string }[]) {
      if (openIds.has(link.counter_id)) openByService[link.service_id] = (openByService[link.service_id] ?? 0) + 1
    }
    const waitNowMins = links.error
      ? null
      : estimateWaitMins(rows.filter((row) => row.day === today), openByService)

    return {
      orgId,
      stats: { waiting, servedToday, countersOpen, avgServiceMins, waitNowMins },
      avgSecsByService,
      waitingByService,
    }
  } catch {
    return null
  }
}

// No public table records how long people actually waited, so this is an
// estimate from real board numbers, and the landing page labels it that way:
// per service with a queue, people waiting x its rolling average visit /
// its open counters, then the mean across those services. 0 when nobody is
// waiting anywhere; null when every queue is stalled (no open counter) or
// has no average yet, rather than a guess.
export function estimateWaitMins(
  today: Pick<BoardServiceRow, "service_id" | "waiting_count" | "avg_service_secs">[],
  openByService: Record<string, number>,
): number | null {
  const queued = today.filter((row) => row.waiting_count > 0)
  if (queued.length === 0) return 0
  const secs = queued
    .filter((row) => row.avg_service_secs != null && (openByService[row.service_id] ?? 0) > 0)
    .map((row) => (row.waiting_count * row.avg_service_secs!) / openByService[row.service_id])
  if (secs.length === 0) return null
  return Math.max(1, Math.round(secs.reduce((a, b) => a + b, 0) / secs.length / 60))
}
