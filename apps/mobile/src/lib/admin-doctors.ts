import type { DoctorStatusValue } from '@/lib/doctors';

export const DOCTOR_STATUS_LABELS: Record<DoctorStatusValue, string> = {
  available: 'Available',
  running_late: 'Running late',
  on_break: 'On break',
  off: 'Off today',
};

// doctor_schedules/doctor_breaks.weekday is Postgres extract(dow): Sunday = 0 .. Saturday = 6.
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "09:00:00" -> "09:00". */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

export function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Real calendar date in YYYY-MM-DD (rejects 2026-02-30). */
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Start/end window check shared by shifts and breaks. Returns an error or null. */
export function timeRangeError(start: string, end: string): string | null {
  if (!isTime(start) || !isTime(end)) return 'Use 24-hour HH:MM, e.g. 09:30.';
  if (end <= start) return 'End time must be after start time.';
  return null;
}
