import type { SupabaseClient } from "@supabase/supabase-js"

// When a walk-in token is taken before the doctor's first shift of the day,
// there is no queue to estimate yet: say when it starts instead of an ETA.
// Shared by /my's token card, /t/[id] and the ActiveTokenBar.

export type DoctorStart = { doctorName: string; at: string; label: string }

const seconds = (t: string) => {
  const [h, m, s] = t.split(":").map(Number)
  return h * 3600 + m * 60 + (s || 0)
}

/** The doctor's first shift today, if it has not started yet; otherwise null. */
export async function loadDoctorStart(
  supabase: SupabaseClient,
  doctorId: string | null,
  timeZone: string,
  now: Date = new Date(),
): Promise<DoctorStart | null> {
  if (!doctorId) return null
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now)
  // doctor_schedules.weekday is Postgres dow (Sunday = 0).
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const [{ data: doctor }, { data: shifts }] = await Promise.all([
    supabase.from("doctors").select("name").eq("id", doctorId).maybeSingle(),
    supabase.from("doctor_schedules").select("start_time").eq("doctor_id", doctorId).eq("weekday", weekday),
  ])
  const first = ((shifts ?? []) as { start_time: string }[]).map((s) => s.start_time).sort()[0]
  const nowTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(now)
  if (!first || nowTime >= first) return null
  const at = new Date(now.getTime() + (seconds(first) - seconds(nowTime)) * 1000)
  return {
    doctorName: (doctor as { name: string } | null)?.name ?? "the doctor",
    at: at.toISOString(),
    label: at.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" }),
  }
}

/** "You're #3 in line · Queue starts when Dr. Neha Sharma arrives at 9:00 AM" */
export function queueStartsLine(ahead: number | null, start: DoctorStart): string {
  const place = ahead === null ? "" : `You're #${ahead + 1} in line · `
  return `${place}Queue starts when ${start.doctorName} arrives at ${start.label}`
}

/** Still before the shift at `nowMs`? */
export function beforeStart(start: DoctorStart | null, nowMs: number): start is DoctorStart {
  return !!start && nowMs < Date.parse(start.at)
}
