import type { SupabaseClient } from "@supabase/supabase-js"

import { loadBoard } from "@/app/_landing/board"
import { fetchCounter, type CounterRow, type TokenRow, type TokenStatus } from "@/app/t/[id]/data"
import { ACTIVE_STATUSES, readTokenStatus, type RequestedLane } from "@/components/tokens/active-token"
import type { DoctorStatus } from "@/lib/doctors"

import {
  availability,
  clockNow,
  dayKey,
  paidStatusOverride,
  shiftsLabel,
  slotLabel,
  type Availability,
  type Tone,
} from "./format"

type PaymentStatus = "created" | "captured" | "failed" | "refunded" | null

// my_payment_status (0058) is the one owner-read door onto the otherwise admin-only payments
// table -- one row or none for a hold you own. Never worth calling for pending_payment (that
// already renders its own "Awaiting payment" chip with no RPC needed).
async function loadPaidStatus(
  supabase: SupabaseClient,
  target: { tokenId: string } | { appointmentId: string },
): Promise<PaymentStatus> {
  const { data } = await supabase.rpc("my_payment_status", {
    p_token_id: "tokenId" in target ? target.tokenId : null,
    p_appointment_id: "appointmentId" in target ? target.appointmentId : null,
  })
  return (data?.[0]?.status as PaymentStatus) ?? null
}

// Server-side reads for /my. Every table here is already read the same way
// elsewhere (t/[id]/data.ts, lib/doctors.ts, _landing/board.ts, the mobile
// app); nothing new is exposed. The client is the unparameterized one, so
// rows are cast to local shapes, same as those files do.

type Named = { name: string } | { name: string }[] | null
// PostgREST returns a to-one embed as an object, but the untyped client can't
// know that, so accept either shape.
const nameOf = (v: Named): string | null => (Array.isArray(v) ? v[0]?.name : v?.name) ?? null

export type Org = { id: string | null; name: string; timeZone: string }

export async function loadOrg(supabase: SupabaseClient, orgId: string | null): Promise<Org> {
  // Patients usually have no org_id; the demo runs one hospital, so fall back to it.
  // Oldest first: the hospital, not an org a load test added later.
  const query = supabase.from("organizations").select("id, name, timezone")
  const { data } = await (orgId ? query.eq("id", orgId) : query.order("created_at").limit(1)).maybeSingle()
  return { id: data?.id ?? null, name: data?.name ?? "Queueless", timeZone: data?.timezone ?? "Asia/Kolkata" }
}

// ---------- the patient's live token ----------

export type ActiveToken = {
  token: TokenRow
  serviceName: string
  doctorName: string | null
  ahead: number | null
  counter: CounterRow | null
  requestedLane: RequestedLane
}

export async function loadActiveToken(supabase: SupabaseClient, userId: string): Promise<ActiveToken | null> {
  const { data } = await supabase
    .from("tokens")
    .select(
      "id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, counter_id, created_at, called_at, serving_at, finished_at, requested_lane, services(name), doctors(name)",
    )
    .eq("patient_id", userId)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null

  const { services, doctors, requested_lane, ...token } = data as TokenRow & {
    services: Named
    doctors: Named
    requested_lane: RequestedLane
  }
  const [status, counter] = await Promise.all([
    token.status === "waiting" ? readTokenStatus(supabase, token.id) : null,
    token.counter_id ? fetchCounter(supabase, token.counter_id) : null,
  ])
  const ahead = status?.ahead ?? null
  return {
    token,
    serviceName: nameOf(services) ?? "Queueless",
    doctorName: nameOf(doctors),
    ahead,
    counter,
    requestedLane: requested_lane,
  }
}

// ---------- departments ----------

export type Department = { id: string; name: string; code: string; waiting: number }

// Scoped to the hospital: services is readable across orgs, and prod also
// carries a load-test org whose queue a patient should never see.
export async function loadDepartments(supabase: SupabaseClient, orgId: string | null): Promise<Department[]> {
  const services = supabase.from("services").select("id, name, code").eq("is_open", true).order("name")
  const [{ data }, board] = await Promise.all([
    orgId ? services.eq("org_id", orgId) : services,
    loadBoard(supabase),
  ])
  return ((data ?? []) as { id: string; name: string; code: string }[]).map((s) => ({
    ...s,
    waiting: board?.waitingByService[s.id] ?? 0,
  }))
}

// ---------- doctors ----------

export type Slot = { id: string; label: string }

export type DashboardDoctor = {
  id: string
  name: string
  specialty: string
  feeInr: number
  room: string | null
  serviceId: string
  serviceName: string
  availability: Availability
  /** Today's clinic hours, "9 AM - 1 PM, 5 PM - 8 PM"; empty when off. */
  hours: string
  /** Upcoming slots that still have room, soonest first. */
  slots: Slot[]
}

type DoctorRow = { id: string; service_id: string; name: string; specialty: string; room: string | null; fee_inr: number }
type SlotRow = { id: string; starts_at: string; capacity: number; booked: number }

export async function loadDoctors(
  supabase: SupabaseClient,
  orgId: string | null,
  timeZone: string,
  now: Date,
): Promise<DashboardDoctor[]> {
  const today = dayKey(now, timeZone)
  // doctor_schedules.weekday is Postgres dow (Sunday = 0), same as getUTCDay on a noon-UTC date.
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()

  const doctorsQuery = supabase
    .from("doctors")
    .select("id, service_id, name, specialty, room, fee_inr")
    .eq("active", true)
    .order("name")
  const [doctorsRes, servicesRes, statusRes, shiftsRes, leavesRes, breaksRes] = await Promise.all([
    orgId ? doctorsQuery.eq("org_id", orgId) : doctorsQuery,
    supabase.from("services").select("id, name"),
    supabase.from("doctor_status_today").select("doctor_id, status, late_minutes"),
    supabase.from("doctor_schedules").select("doctor_id, start_time, end_time").eq("weekday", weekday),
    supabase.from("doctor_leaves").select("doctor_id, reason").lte("from_date", today).gte("to_date", today),
    supabase.from("doctor_breaks").select("doctor_id, start_time, end_time").eq("weekday", weekday),
  ])
  const doctors = (doctorsRes.data ?? []) as DoctorRow[]
  const nowTime = clockNow(now, timeZone)
  const breaks = new Map<string, { start: string; end: string }[]>()
  for (const b of (breaksRes.data ?? []) as { doctor_id: string; start_time: string; end_time: string }[]) {
    breaks.set(b.doctor_id, [...(breaks.get(b.doctor_id) ?? []), { start: b.start_time, end: b.end_time }])
  }

  // One small query per doctor: a shared one would need a row cap that one
  // busy doctor could eat. 40 covers more than a full day of 15-minute slots.
  const slotRows = await Promise.all(
    doctors.map((d) =>
      supabase
        .from("appointment_slots")
        .select("id, starts_at, capacity, booked")
        .eq("doctor_id", d.id)
        .gt("starts_at", now.toISOString())
        .order("starts_at")
        .limit(40)
        .then(({ data }) => (data ?? []) as SlotRow[]),
    ),
  )

  const serviceName = new Map(((servicesRes.data ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))
  const status = new Map(
    ((statusRes.data ?? []) as { doctor_id: string; status: DoctorStatus; late_minutes: number | null }[]).map((s) => [
      s.doctor_id,
      s,
    ]),
  )
  const shifts = new Map<string, { start: string; end: string }[]>()
  for (const s of (shiftsRes.data ?? []) as { doctor_id: string; start_time: string; end_time: string }[]) {
    const list = shifts.get(s.doctor_id) ?? []
    list.push({ start: s.start_time, end: s.end_time })
    shifts.set(s.doctor_id, list)
  }
  const leave = new Map(((leavesRes.data ?? []) as { doctor_id: string; reason: string | null }[]).map((l) => [l.doctor_id, l.reason]))

  return doctors.map((d, i) => {
    const today = shifts.get(d.id) ?? []
    const st = status.get(d.id)
    return {
      id: d.id,
      name: d.name,
      specialty: d.specialty,
      feeInr: d.fee_inr,
      room: d.room,
      serviceId: d.service_id,
      serviceName: serviceName.get(d.service_id) ?? "",
      availability: availability({
        status: st?.status ?? "available",
        lateMinutes: st?.late_minutes ?? null,
        leaveReason: leave.has(d.id) ? leave.get(d.id) : undefined,
        hasShiftToday: today.length > 0,
        shifts: today,
        breaks: breaks.get(d.id) ?? [],
        nowTime,
      }),
      hours: shiftsLabel(today),
      slots: slotRows[i]
        .filter((s) => s.booked < s.capacity)
        .slice(0, 24)
        .map((s) => ({ id: s.id, label: slotLabel(s.starts_at, timeZone, now) })),
    }
  })
}

// ---------- appointments + history ----------

const CHECKIN_GRACE_MS = 15 * 60_000

export type Appointment = {
  id: string
  /** "Today, 5:00 PM" */
  when: string
  doctor: string | null
  service: string
  /** paid / booked (free, pre-0068) / pending: a 10-minute hold awaiting payment / refunded. */
  state: "paid" | "booked" | "pending" | "refunded"
  holdExpiresAt: string | null
  feeInr: number | null
  /** Slot start, ISO: decides whether a paid cancel still refunds itself (0059, 2 hours). */
  startsAt: string
  /** The doctor's live status for that day, e.g. "Running late, expect ~9:20 AM". */
  doctorLine: { text: string; tone: Tone } | null
}

type AppointmentRow = {
  id: string
  doctor_id: string | null
  status: "booked" | "pending_payment" | "cancelled"
  fee_inr: number | null
  hold_expires_at: string | null
  appointment_slots: { starts_at: string } | { starts_at: string }[] | null
  doctors: Named
  services: Named
}

// Every upcoming appointment the patient holds: booked (Paid when an online
// payment was captured), pending_payment holds still inside their 10 minutes,
// and cancelled ones only when the payment came back as a refund. Paid vs
// refunded comes from loadPaidStatus (my_payment_status, 0058), one call per row.
// Plain function: /my renders it on the server and Appointments re-reads it
// in the browser on mount and focus, so coming back from checkout is fresh.
export async function loadAppointments(
  supabase: SupabaseClient,
  userId: string,
  timeZone: string,
  now: Date,
): Promise<Appointment[]> {
  const { data } = await supabase
    .from("appointments")
    .select("id, doctor_id, status, fee_inr, hold_expires_at, appointment_slots(starts_at), doctors(name), services(name)")
    .eq("patient_id", userId)
    .in("status", ["booked", "pending_payment", "cancelled"])
  const rows = ((data ?? []) as AppointmentRow[])
    .map((a) => {
      const slot = Array.isArray(a.appointment_slots) ? a.appointment_slots[0] : a.appointment_slots
      return { ...a, startsAt: slot?.starts_at ?? "" }
    })
    // check_in (0072) stays open until 15 minutes after the start, so keep the row until then.
    .filter((a) => a.startsAt && new Date(a.startsAt).getTime() + CHECKIN_GRACE_MS > now.getTime())
    .filter((a) => a.status !== "pending_payment" || !a.hold_expires_at || new Date(a.hold_expires_at) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  // Doctor status for the row's own day: doctor_status_today only speaks for
  // today, a leave can cover any day.
  const doctorIds = [...new Set(rows.map((a) => a.doctor_id).filter((id): id is string => !!id))]
  const today = dayKey(now, timeZone)
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const [statusRes, leavesRes, shiftsRes, breaksRes] = doctorIds.length
    ? await Promise.all([
        supabase.from("doctor_status_today").select("doctor_id, status, late_minutes").in("doctor_id", doctorIds),
        supabase.from("doctor_leaves").select("doctor_id, from_date, to_date").in("doctor_id", doctorIds).gte("to_date", today),
        supabase.from("doctor_schedules").select("doctor_id, start_time, end_time").in("doctor_id", doctorIds).eq("weekday", weekday),
        supabase.from("doctor_breaks").select("doctor_id, start_time, end_time").in("doctor_id", doctorIds).eq("weekday", weekday),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
  type TimeRow = { doctor_id: string; start_time: string; end_time: string }
  const windowsOf = (rows: TimeRow[] | null, id: string) =>
    (rows ?? []).filter((r) => r.doctor_id === id).map((r) => ({ start: r.start_time, end: r.end_time }))
  const nowTime = clockNow(now, timeZone)
  const statusOf = new Map(
    ((statusRes.data ?? []) as { doctor_id: string; status: DoctorStatus; late_minutes: number | null }[]).map((r) => [
      r.doctor_id,
      r,
    ]),
  )
  const leaves = (leavesRes.data ?? []) as { doctor_id: string; from_date: string; to_date: string }[]
  function doctorLine(doctorId: string | null, startsAt: string): Appointment["doctorLine"] {
    if (!doctorId) return null
    const day = dayKey(new Date(startsAt), timeZone)
    if (leaves.some((l) => l.doctor_id === doctorId && l.from_date <= day && l.to_date >= day)) {
      return { text: "Doctor on leave that day. A paid booking is refunded automatically.", tone: "danger" }
    }
    if (day !== today) return null
    const st = statusOf.get(doctorId)
    // Same time-of-day rules as the directory: the stored status only counts during a shift.
    const shifts = windowsOf(shiftsRes.data as TimeRow[] | null, doctorId)
    const a = availability({
      status: st?.status ?? "available",
      lateMinutes: st?.late_minutes ?? null,
      leaveReason: undefined,
      hasShiftToday: shifts.length > 0,
      shifts,
      breaks: windowsOf(breaksRes.data as TimeRow[] | null, doctorId),
      nowTime,
    })
    if (a.kind === "leave" || a.kind === "off") return { text: "Doctor not seeing patients today", tone: "danger" }
    // "Opens at 9 AM" -> "Doctor starts at 9 AM"; "Back at 5 PM" / "On a break until…" -> "Doctor back at…".
    const lower = a.label.charAt(0).toLowerCase() + a.label.slice(1)
    if (a.kind === "before") return { text: `Doctor starts ${lower.replace(/^opens /, "")}`, tone: "neutral" }
    if (a.kind === "between") return { text: `Doctor ${lower}`, tone: "neutral" }
    if (a.kind === "break") return { text: `Doctor ${lower}`, tone: "warning" }
    if (a.kind === "after") return null
    if (st?.status === "running_late") {
      if (!st.late_minutes) return { text: "Doctor running late", tone: "warning" }
      const expect = new Date(new Date(startsAt).getTime() + st.late_minutes * 60_000).toLocaleTimeString("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      })
      return { text: `Doctor running ${st.late_minutes} min late, expect ~${expect}`, tone: "warning" }
    }
    return { text: "Doctor available today", tone: "success" }
  }

  const payments = await Promise.all(
    rows.map((a) =>
      a.status === "pending_payment" ? null : loadPaidStatus(supabase, { appointmentId: a.id }),
    ),
  )

  const out: Appointment[] = []
  rows.forEach((a, i) => {
    const pay = payments[i]
    const state: Appointment["state"] | null =
      a.status === "pending_payment"
        ? "pending"
        : a.status === "cancelled"
          ? pay === "refunded"
            ? "refunded"
            : null
          : pay === "refunded"
            ? "refunded"
            : pay === "captured"
              ? "paid"
              : "booked"
    if (!state) return
    out.push({
      id: a.id,
      when: slotLabel(a.startsAt, timeZone, now),
      doctor: nameOf(a.doctors),
      service: nameOf(a.services) ?? "",
      state,
      holdExpiresAt: a.hold_expires_at,
      feeInr: a.fee_inr,
      startsAt: a.startsAt,
      doctorLine: doctorLine(a.doctor_id, a.startsAt),
    })
  })
  return out
}

export type Visit = {
  id: string
  code: string
  service: string
  doctor: string | null
  status: TokenStatus
  date: string
  /** Overrides the plain status chip when the token was paid online. */
  paidStatus: { label: string; tone: Tone } | null
}

// A token that was ever paid online only needs the check when it's not still pending_payment
// (that already has its own chip) -- covers both a currently-waiting/done paid token ("Paid")
// and one that was later cancelled and refunded ("Refunded" instead of a plain "Cancelled").
const PAID_STATUS_CHECK_STATUSES: TokenStatus[] = ["waiting", "called", "serving", "done", "cancelled"]

export async function loadRecentVisits(supabase: SupabaseClient, userId: string, timeZone: string): Promise<Visit[]> {
  const { data } = await supabase
    .from("tokens")
    .select("id, code, status, created_at, services(name), doctors(name)")
    .eq("patient_id", userId)
    .order("created_at", { ascending: false })
    .limit(5)
  type Row = { id: string; code: string; status: TokenStatus; created_at: string; services: Named; doctors: Named }
  return Promise.all(
    ((data ?? []) as Row[]).map(async (t) => ({
    id: t.id,
    code: t.code,
    service: nameOf(t.services) ?? "",
    doctor: nameOf(t.doctors),
    status: t.status,
    paidStatus: PAID_STATUS_CHECK_STATUSES.includes(t.status)
      ? paidStatusOverride(await loadPaidStatus(supabase, { tokenId: t.id }))
      : null,
    date: new Date(t.created_at).toLocaleDateString("en-US", { timeZone, day: "numeric", month: "short", year: "numeric" }),
    })),
  )
}
