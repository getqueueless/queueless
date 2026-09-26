// Pre-shift rule shared by /t (QueueTracker), ActiveTokenBar and /my: while
// a token's doctor hasn't started today's shift (or is between shifts), the
// queue can't move, so show when it starts instead of an ETA countdown.
// Times are the doctor's local (IST) wall clock, doctor_schedules' "HH:MM:SS".

export type ShiftGate = { kind: "before" | "between"; at: string }

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export function clock12(t: string): string {
  const m = minutes(t)
  const h = Math.floor(m / 60)
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

// null means "no gate": on shift now, after the last shift, or no schedule today.
export function shiftGate(shifts: { start_time: string; end_time: string }[], nowMin: number): ShiftGate | null {
  const today = [...shifts].sort((a, b) => minutes(a.start_time) - minutes(b.start_time))
  if (today.length === 0) return null
  if (nowMin < minutes(today[0].start_time)) return { kind: "before", at: clock12(today[0].start_time) }
  for (let i = 0; i < today.length; i++) {
    if (nowMin < minutes(today[i].end_time)) return null // inside shift i
    const next = today[i + 1]
    if (next && nowMin < minutes(next.start_time)) return { kind: "between", at: clock12(next.start_time) }
  }
  return null
}

// IST wall clock: weekday (0 = Sunday, like Postgres dow) and minutes since midnight.
export function istNow(date = new Date()): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) }
}
