import type { SupabaseClient } from "@supabase/supabase-js"

export type DoctorStatus = "available" | "running_late" | "on_break" | "off"

export type Doctor = {
  id: string
  serviceId: string
  name: string
  specialty: string
  qualification: string | null
  room: string | null
  photoUrl: string | null
  feeInr: number
  status: DoctorStatus
  lateMinutes: number | null
}

export type DoctorShift = {
  id: string
  weekday: number
  startTime: string
  endTime: string
  maxPatients: number
  slotMinutes: number
}

// Real and live (supabase/migrations/0038_doctors_schedules.sql): doctors,
// their weekly schedules/breaks/leaves, and doctor_status_today (a view that
// reads back 'available' for any row not stamped today -- no midnight reset
// job needed). Public read (anon + authenticated), so this works on both the
// signed-out landing page's "01 02 03 04" services teaser and the signed-in
// patient app.
//
// NOTE for whoever builds booking: `appointment_slots` (0005) is per-SERVICE,
// not per-doctor -- there is no doctor_id column on a slot. "Book a slot with
// this doctor" is a UI framing only: show the doctor's `doctor_schedules` as
// informational shift times, but `book_appointment(p_slot)` books the
// service's own slot, not a specific doctor. Don't invent a doctor_id filter
// on appointment_slots that doesn't exist in the schema.
export async function listDoctorsForService(
  supabase: SupabaseClient,
  serviceId: string,
): Promise<Doctor[]> {
  const { data: doctors, error } = await supabase
    .from("doctors")
    .select("id, service_id, name, specialty, qualification, room, photo_url, fee_inr")
    .eq("service_id", serviceId)
    .eq("active", true)
    .order("name")

  if (error || !doctors) return []

  const { data: statuses } = await supabase
    .from("doctor_status_today")
    .select("doctor_id, status, late_minutes")
    .in(
      "doctor_id",
      doctors.map((d) => d.id),
    )

  const byId = new Map((statuses ?? []).map((s) => [s.doctor_id as string, s]))

  return doctors.map((d) => {
    const status = byId.get(d.id)
    return {
      id: d.id,
      serviceId: d.service_id,
      name: d.name,
      specialty: d.specialty,
      qualification: d.qualification,
      room: d.room,
      photoUrl: d.photo_url,
      feeInr: d.fee_inr,
      status: (status?.status as DoctorStatus) ?? "available",
      lateMinutes: (status?.late_minutes as number | null) ?? null,
    }
  })
}

export async function listTodaysShifts(
  supabase: SupabaseClient,
  doctorId: string,
  weekday: number,
): Promise<DoctorShift[]> {
  const { data, error } = await supabase
    .from("doctor_schedules")
    .select("id, weekday, start_time, end_time, max_patients, slot_minutes")
    .eq("doctor_id", doctorId)
    .eq("weekday", weekday)
    .order("start_time")

  if (error || !data) return []

  return data.map((s) => ({
    id: s.id,
    weekday: s.weekday,
    startTime: s.start_time,
    endTime: s.end_time,
    maxPatients: s.max_patients,
    slotMinutes: s.slot_minutes,
  }))
}

export const DOCTOR_STATUS_LABEL: Record<DoctorStatus, string> = {
  available: "Available",
  running_late: "Running late",
  on_break: "On break",
  off: "On leave",
}
