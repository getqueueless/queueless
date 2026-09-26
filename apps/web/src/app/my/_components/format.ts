import type { TokenStatus } from "@/app/t/[id]/data"
import type { DoctorStatus } from "@/lib/doctors"

// Pure helpers for the patient dashboard. No Supabase, no React, so the
// branches are checked by format.test.mjs with plain `node --test`.

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger"

export const TOKEN_STATUS: Record<TokenStatus, { label: string; tone: Tone }> = {
  pending_payment: { label: "Awaiting payment", tone: "warning" },
  waiting: { label: "Waiting", tone: "neutral" },
  called: { label: "Called", tone: "primary" },
  serving: { label: "With the doctor", tone: "primary" },
  done: { label: "Done", tone: "success" },
  skipped: { label: "Skipped", tone: "danger" },
  no_show: { label: "No-show", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
}

export const AVAILABILITY_TONE: Record<Availability["kind"], Tone> = {
  available: "success",
  late: "warning",
  break: "warning",
  leave: "danger",
  off: "neutral",
  before: "neutral",
  between: "neutral",
  after: "neutral",
}

// payments stays admin-only (0051/0053) -- my_payment_status (0058) is the one owner-read door,
// returning just enough to override the plain token/appointment status chip when it's paid
// online: "captured" means the underlying status already flipped away from pending_payment (so
// TOKEN_STATUS would otherwise just say "Waiting"/"Booked"), "refunded" means it's cancelled FOR
// a reason worth calling out, not just any cancellation.
export function paidStatusOverride(
  paymentStatus: "created" | "captured" | "failed" | "refunded" | null,
): { label: string; tone: Tone } | null {
  if (paymentStatus === "refunded") return { label: "Refunded", tone: "neutral" }
  if (paymentStatus === "captured") return { label: "Paid", tone: "success" }
  return null
}

/** "Dr. Neha Sharma" -> "NS": the title is not a name. */
export function initials(name: string): string {
  const words = name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase()
}

export type Availability = {
  kind: "available" | "late" | "break" | "leave" | "off" | "before" | "between" | "after"
  label: string
  /** Why the doctor cannot be booked today; null when they can. */
  reason: string | null
  bookable: boolean
}

type Window = { start: string; end: string }

// doctor_leaves beats doctor_status (a leave is planned, a status is today's
// note), and a doctor with no doctor_schedules row for today's weekday is off
// whatever their status says. leaveReason is undefined when there is no leave
// row today, null when there is one without a reason.
//
// With today's shifts, breaks and the hospital's clock (nowTime "HH:MM:SS"),
// the stored status only speaks while a shift is on: before, between and after
// shifts, and inside a break window, the clock decides. Future slots stay
// bookable in all of those.
export function availability({
  status,
  lateMinutes,
  leaveReason,
  hasShiftToday,
  shifts,
  breaks = [],
  nowTime,
}: {
  status: DoctorStatus
  lateMinutes: number | null
  leaveReason: string | null | undefined
  hasShiftToday: boolean
  shifts?: Window[]
  breaks?: Window[]
  nowTime?: string
}): Availability {
  if (leaveReason !== undefined || status === "off") {
    return { kind: "leave", label: "On leave", reason: leaveReason || "Not seeing patients today", bookable: false }
  }
  if (!hasShiftToday) return { kind: "off", label: "Not seeing patients today", reason: "No clinic hours today", bookable: false }
  if (shifts?.length && nowTime) {
    const sorted = [...shifts].sort((x, y) => x.start.localeCompare(y.start))
    const current = sorted.find((w) => w.start <= nowTime && nowTime < w.end)
    if (!current) {
      const next = sorted.find((w) => nowTime < w.start)
      if (!next) return { kind: "after", label: "Done for today, book for tomorrow", reason: null, bookable: true }
      return next === sorted[0]
        ? { kind: "before", label: `Opens at ${clockLabel(next.start)}`, reason: null, bookable: true }
        : { kind: "between", label: `Back at ${clockLabel(next.start)}`, reason: null, bookable: true }
    }
    const pause = breaks.find((w) => w.start <= nowTime && nowTime < w.end)
    if (pause) return { kind: "break", label: `On a break until ${clockLabel(pause.end)}`, reason: null, bookable: true }
  }
  if (status === "running_late") {
    return { kind: "late", label: lateMinutes ? `Running late ${lateMinutes} min` : "Running late", reason: null, bookable: true }
  }
  if (status === "on_break") return { kind: "break", label: "On break", reason: null, bookable: true }
  return { kind: "available", label: "Available", reason: null, bookable: true }
}

/** The hospital's wall clock as "HH:MM:SS", comparable with Postgres `time` strings. */
export function clockNow(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date)
}

export function firstName(fullName: string | null): string | null {
  return fullName?.trim().split(/\s+/)[0] || null
}

/** A Postgres `time` ("13:30:00") on a 12-hour clock ("1:30 PM"). */
export function clockLabel(time: string): string {
  const [h, m] = time.split(":").map(Number)
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "PM" : "AM"}`
}

export function shiftsLabel(shifts: { start: string; end: string }[]): string {
  return [...shifts]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((s) => `${clockLabel(s.start)} - ${clockLabel(s.end)}`)
    .join(", ")
}

/** The calendar date (YYYY-MM-DD) in the hospital's zone. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date)
}

// ponytail: "tomorrow" is now + 24h, which is off by an hour around a DST
// change; the demo org is Asia/Kolkata (no DST). Step the calendar date
// instead if an org in a DST zone ever shows up.
export function slotLabel(startsAt: string, timeZone: string, now: Date): string {
  const at = new Date(startsAt)
  const time = at.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
  const day = dayKey(at, timeZone)
  if (day === dayKey(now, timeZone)) return `Today, ${time}`
  if (day === dayKey(new Date(now.getTime() + 86_400_000), timeZone)) return `Tomorrow, ${time}`
  // en-US parts, not en-GB's string: newer ICU spells September "Sept" there.
  const part = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", day: "numeric", month: "short" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  return `${part.weekday} ${part.day} ${part.month}, ${time}`
}

/** Years between a YYYY-MM-DD birth date and a YYYY-MM-DD day (the org's today). */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number)
  const [ty, tm, td] = today.split("-").map(Number)
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0)
}
