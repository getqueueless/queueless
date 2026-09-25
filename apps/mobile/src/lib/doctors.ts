import { supabase } from '@/lib/supabase';
import { hospitalOrgId } from '@/lib/hospital-org';
import { todayDateString } from '@/lib/service-day';

export type DoctorStatusValue = 'available' | 'running_late' | 'on_break' | 'off';

export type Doctor = {
  id: string;
  org_id: string;
  service_id: string;
  name: string;
  specialty: string;
  qualification: string | null;
  room: string | null;
  photo_url: string | null;
  fee_inr: number;
  active: boolean;
};

type DoctorStatusRow = { doctor_id: string; status: DoctorStatusValue; late_minutes: number | null };
type DoctorScheduleRow = { doctor_id: string; weekday: number; start_time: string; end_time: string };
type DoctorLeaveRow = { doctor_id: string; from_date: string; to_date: string };

export type DoctorWithStatus = Doctor & {
  status: DoctorStatusValue;
  lateMinutes: number | null;
  onLeaveToday: boolean;
  todayShifts: string[];
};

const STATUS_LABELS: Record<DoctorStatusValue, string> = {
  available: 'Available',
  running_late: 'Running late',
  on_break: 'On break',
  off: 'On leave',
};

export function doctorStatusLabel(doctor: Pick<DoctorWithStatus, 'status' | 'lateMinutes' | 'onLeaveToday'>): string {
  if (doctor.onLeaveToday) return STATUS_LABELS.off;
  if (doctor.status === 'running_late' && doctor.lateMinutes) {
    return `Running ${doctor.lateMinutes} min late`;
  }
  return STATUS_LABELS[doctor.status];
}

/** Collapses the real 4-value status onto components/ui's DoctorCard/StatusChip 3-value scale
 * (available/late/leave) -- `on_break` reads as "late" with its own label, since neither chip
 * vocabulary has a dedicated "on break" state. */
export function doctorCardStatus(doctor: Pick<DoctorWithStatus, 'status' | 'onLeaveToday'>): 'available' | 'late' | 'leave' {
  if (doctor.onLeaveToday || doctor.status === 'off') return 'leave';
  if (doctor.status === 'running_late' || doctor.status === 'on_break') return 'late';
  return 'available';
}

/** 12-hour clock from a Postgres `time` string ("09:00:00" / "13:30:00"). */
function formatTime(value: string): string {
  const [hStr, mStr] = value.split(':');
  const hour24 = Number(hStr);
  const minute = Number(mStr);
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0 ? `${hour12} ${period}` : `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function formatFee(feeInr: number): string {
  return feeInr > 0 ? `₹${feeInr}` : 'Free';
}

// Postgres extract(dow from date) and JS Date#getDay() agree: Sunday = 0 .. Saturday = 6. Parsed
// at noon (not midnight) so no device timezone can roll the calendar date itself backward.
function todayWeekday(): number {
  return new Date(`${todayDateString()}T12:00:00`).getDay();
}

/**
 * Doctors for one department (service), each carrying today's live status
 * (doctor_status_today, per supabase/README.md's "Doctors & schedules" section — a stale row
 * reads back as `available`) and today's shifts. `active=false` doctors are soft-deactivated
 * and excluded, same as the admin console does.
 */
export async function fetchDoctorsForService(serviceId: string): Promise<DoctorWithStatus[]> {
  const today = todayDateString();
  const weekday = todayWeekday();

  const [doctorsRes, statusRes, schedulesRes, leavesRes] = await Promise.all([
    supabase.from('doctors').select('*').eq('service_id', serviceId).eq('active', true),
    supabase.from('doctor_status_today').select('doctor_id, status, late_minutes'),
    supabase.from('doctor_schedules').select('doctor_id, weekday, start_time, end_time').eq('weekday', weekday),
    supabase.from('doctor_leaves').select('doctor_id, from_date, to_date').lte('from_date', today).gte('to_date', today),
  ]);

  if (doctorsRes.error) throw doctorsRes.error;

  const statusByDoctor: Record<string, DoctorStatusRow> = {};
  for (const row of (statusRes.data ?? []) as DoctorStatusRow[]) statusByDoctor[row.doctor_id] = row;

  const shiftsByDoctor: Record<string, string[]> = {};
  for (const row of (schedulesRes.data ?? []) as DoctorScheduleRow[]) {
    const label = `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`;
    (shiftsByDoctor[row.doctor_id] ??= []).push(label);
  }

  const onLeaveDoctors = new Set(((leavesRes.data ?? []) as DoctorLeaveRow[]).map((row) => row.doctor_id));

  return ((doctorsRes.data ?? []) as Doctor[]).map((doctor) => {
    const status = statusByDoctor[doctor.id];
    return {
      ...doctor,
      status: status?.status ?? 'available',
      lateMinutes: status?.late_minutes ?? null,
      onLeaveToday: onLeaveDoctors.has(doctor.id),
      todayShifts: shiftsByDoctor[doctor.id] ?? [],
    };
  });
}

export type DoctorWithService = DoctorWithStatus & { serviceName: string };

/**
 * Every active doctor across every department, for the Doctors tab's flat search+filter list --
 * `fetchDoctorsForService` stays scoped to one department (department screen still uses it).
 */
export async function fetchAllDoctors(): Promise<DoctorWithService[]> {
  const today = todayDateString();
  const weekday = todayWeekday();
  const orgId = await hospitalOrgId();
  const doctorsQuery = supabase.from('doctors').select('*').eq('active', true);

  const [doctorsRes, servicesRes, statusRes, schedulesRes, leavesRes] = await Promise.all([
    orgId ? doctorsQuery.eq('org_id', orgId) : doctorsQuery,
    supabase.from('services').select('id, name'),
    supabase.from('doctor_status_today').select('doctor_id, status, late_minutes'),
    supabase.from('doctor_schedules').select('doctor_id, weekday, start_time, end_time').eq('weekday', weekday),
    supabase.from('doctor_leaves').select('doctor_id, from_date, to_date').lte('from_date', today).gte('to_date', today),
  ]);

  if (doctorsRes.error) throw doctorsRes.error;

  const serviceNameById: Record<string, string> = {};
  for (const row of (servicesRes.data ?? []) as { id: string; name: string }[]) serviceNameById[row.id] = row.name;

  const statusByDoctor: Record<string, DoctorStatusRow> = {};
  for (const row of (statusRes.data ?? []) as DoctorStatusRow[]) statusByDoctor[row.doctor_id] = row;

  const shiftsByDoctor: Record<string, string[]> = {};
  for (const row of (schedulesRes.data ?? []) as DoctorScheduleRow[]) {
    const label = `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`;
    (shiftsByDoctor[row.doctor_id] ??= []).push(label);
  }

  const onLeaveDoctors = new Set(((leavesRes.data ?? []) as DoctorLeaveRow[]).map((row) => row.doctor_id));

  return ((doctorsRes.data ?? []) as Doctor[]).map((doctor) => {
    const status = statusByDoctor[doctor.id];
    return {
      ...doctor,
      status: status?.status ?? 'available',
      lateMinutes: status?.late_minutes ?? null,
      onLeaveToday: onLeaveDoctors.has(doctor.id),
      todayShifts: shiftsByDoctor[doctor.id] ?? [],
      serviceName: serviceNameById[doctor.service_id] ?? 'General',
    };
  });
}

export async function fetchDoctor(doctorId: string): Promise<DoctorWithStatus | null> {
  const today = todayDateString();
  const weekday = todayWeekday();

  const [doctorRes, statusRes, schedulesRes, leaveRes] = await Promise.all([
    supabase.from('doctors').select('*').eq('id', doctorId).maybeSingle(),
    supabase.from('doctor_status_today').select('doctor_id, status, late_minutes').eq('doctor_id', doctorId).maybeSingle(),
    supabase.from('doctor_schedules').select('doctor_id, weekday, start_time, end_time').eq('doctor_id', doctorId).eq('weekday', weekday),
    supabase.from('doctor_leaves').select('doctor_id, from_date, to_date').eq('doctor_id', doctorId).lte('from_date', today).gte('to_date', today),
  ]);

  if (doctorRes.error || !doctorRes.data) return null;

  const status = statusRes.data as DoctorStatusRow | null;
  return {
    ...(doctorRes.data as Doctor),
    status: status?.status ?? 'available',
    lateMinutes: status?.late_minutes ?? null,
    onLeaveToday: ((leaveRes.data ?? []) as DoctorLeaveRow[]).length > 0,
    todayShifts: ((schedulesRes.data ?? []) as DoctorScheduleRow[]).map(
      (row) => `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`,
    ),
  };
}

export type NextSlot = { id: string; label: string };

/** A doctor's next few open slots, each with a short time-only label ("9:00 AM") for a pill. */
export async function fetchNextSlots(doctorId: string, limit = 4): Promise<NextSlot[]> {
  const { data } = await supabase
    .from('appointment_slots')
    .select('id, starts_at, booked, capacity')
    .eq('doctor_id', doctorId)
    .gt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit * 3);

  const rows = (data ?? []) as { id: string; starts_at: string; booked: number; capacity: number }[];
  return rows
    .filter((row) => row.booked < row.capacity)
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      // Explicit locale AND hour12 -- the bare `[]` locale silently rendered 24-hour on at least
      // one build (no AM/PM shown), same class of bug checkout/[holdId].tsx's own formatWhen
      // works around.
      label: new Date(row.starts_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    }));
}
