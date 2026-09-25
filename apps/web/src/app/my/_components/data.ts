import type { SupabaseClient } from "@supabase/supabase-js"

import { loadBoard } from "@/app/_landing/board"
import { fetchCounter, type CounterRow, type TokenRow, type TokenStatus } from "@/app/t/[id]/data"
import { ACTIVE_STATUSES, readTokenStatus } from "@/components/tokens/active-token"
import type { DoctorStatus } from "@/lib/doctors"

import { availability, dayKey, paidStatusOverride, shiftsLabel, slotLabel, type Availability, type Tone } from "./format"

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
}

export async function loadActiveToken(supabase: SupabaseClient, userId: string): Promise<ActiveToken | null> {
  const { data } = await supabase
    .from("tokens")
    .select(
      "id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, counter_id, created_at, called_at, serving_at, finished_at, services(name), doctors(name)",
    )
    .eq("patient_id", userId)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null

  const { services, doctors, ...token } = data as TokenRow & { services: Named; doctors: Named }
  const [status, counter] = await Promise.all([
    token.status === "waiting" ? readTokenStatus(supabase, token.id) : null,
    token.counter_id ? fetchCounter(supabase, token.counter_id) : null,
  ])
  const ahead = status?.ahead ?? null
  return { token, serviceName: nameOf(services) ?? "Queueless", doctorName: nameOf(doctors), ahead, counter }
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
  const [doctorsRes, servicesRes, statusRes, shiftsRes, leavesRes] = await Promise.all([
    orgId ? doctorsQuery.eq("org_id", orgId) : doctorsQuery,
    supabase.from("services").select("id, name"),
    supabase.from("doctor_status_today").select("doctor_id, status, late_minutes"),
    supabase.from("doctor_schedules").select("doctor_id, start_time, end_time").eq("weekday", weekday),
    supabase.from("doctor_leaves").select("doctor_id, reason").lte("from_date", today).gte("to_date", today),
  ])
  const doctors = (doctorsRes.data ?? []) as DoctorRow[]

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

export type Appointment = {
  id: string
  when: string
  doctor: string | null
  service: string
  /** pending_payment: a paid slot held for 10 minutes until the payment lands (0056). */
  status: "booked" | "pending_payment"
  /** Overrides the plain status chip when the slot was paid online; null for pending_payment. */
  paidStatus: { label: string; tone: Tone } | null
}

export async function loadAppointments(
  supabase: SupabaseClient,
  userId: string,
  timeZone: string,
  now: Date,
): Promise<Appointment[]> {
  const { data } = await supabase
    .from("appointments")
    .select("id, status, appointment_slots(starts_at), doctors(name), services(name)")
    .eq("patient_id", userId)
    .in("status", ["booked", "pending_payment"])
  type Row = {
    id: string
    status: Appointment["status"]
    appointment_slots: { starts_at: string } | { starts_at: string }[] | null
    doctors: Named
    services: Named
  }
  const upcoming = ((data ?? []) as Row[])
    .map((a) => {
      const slot = Array.isArray(a.appointment_slots) ? a.appointment_slots[0] : a.appointment_slots
      return { ...a, startsAt: slot?.starts_at ?? "" }
    })
    .filter((a) => a.startsAt && new Date(a.startsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  const withPaidStatus = await Promise.all(
    upcoming.map(async (a) => ({
      id: a.id,
      when: slotLabel(a.startsAt, timeZone, now),
      doctor: nameOf(a.doctors),
      service: nameOf(a.services) ?? "",
      status: a.status,
      paidStatus:
        a.status === "booked" ? paidStatusOverride(await loadPaidStatus(supabase, { appointmentId: a.id })) : null,
    })),
  )
  return withPaidStatus
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
