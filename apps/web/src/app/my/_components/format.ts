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
  kind: "available" | "late" | "break" | "leave" | "off"
  label: string
  /** Why the doctor cannot be booked today; null when they can. */
  reason: string | null
  bookable: boolean
}

// doctor_leaves beats doctor_status (a leave is planned, a status is today's
// note), and a doctor with no doctor_schedules row for today's weekday is off
// whatever their status says. leaveReason is undefined when there is no leave
// row today, null when there is one without a reason.
export function availability({
  status,
  lateMinutes,
  leaveReason,
  hasShiftToday,
}: {
  status: DoctorStatus
  lateMinutes: number | null
  leaveReason: string | null | undefined
  hasShiftToday: boolean
}): Availability {
  if (leaveReason !== undefined || status === "off") {
    return { kind: "leave", label: "On leave", reason: leaveReason || "Not seeing patients today", bookable: false }
  }
  if (!hasShiftToday) return { kind: "off", label: "Off today", reason: "No clinic hours today", bookable: false }
  if (status === "running_late") {
    return { kind: "late", label: lateMinutes ? `Running late ${lateMinutes} min` : "Running late", reason: null, bookable: true }
  }
  if (status === "on_break") return { kind: "break", label: "On break", reason: null, bookable: true }
  return { kind: "available", label: "Available", reason: null, bookable: true }
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
