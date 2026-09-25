// Must match the server's private.service_day(org_id, now()) — (now() at time zone
// org.timezone)::date, and organizations.timezone defaults to Asia/Kolkata (single-org
// hackathon demo). UTC-sliced would diverge from the real service day for ~5.5h/day
// (00:00-05:30 IST). Shared by every screen that filters tokens/board rows to "today" instead
// of re-deriving it per screen — see docs/DECISIONS.md for the original bug this fixed.
export function todayDateString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
