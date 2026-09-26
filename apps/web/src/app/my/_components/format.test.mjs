// Run from apps/web: node --experimental-strip-types --test src/app/my/_components/format.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"

import { ageOn, availability, clockNow, clockLabel, dayKey, firstName, initials, shiftsLabel, slotLabel } from "./format.ts"

const base = { status: "available", lateMinutes: null, leaveReason: undefined, hasShiftToday: true }

test("a leave row wins over everything, and carries its reason", () => {
  const a = availability({ ...base, status: "running_late", lateMinutes: 20, leaveReason: "Conference" })
  assert.deepEqual(a, { kind: "leave", label: "On leave", reason: "Conference", bookable: false })
  assert.equal(availability({ ...base, leaveReason: null }).reason, "Not seeing patients today")
})

test("status off reads as on leave", () => {
  assert.equal(availability({ ...base, status: "off" }).kind, "leave")
})

test("no shift today is off today, not bookable", () => {
  const a = availability({ ...base, hasShiftToday: false })
  assert.equal(a.kind, "off")
  assert.equal(a.label, "Not seeing patients today")
  assert.equal(a.bookable, false)
})

test("late, break and available stay bookable", () => {
  assert.deepEqual(availability({ ...base, status: "running_late", lateMinutes: 20 }), {
    kind: "late",
    label: "Running late 20 min",
    reason: null,
    bookable: true,
  })
  assert.equal(availability({ ...base, status: "running_late" }).label, "Running late")
  assert.equal(availability({ ...base, status: "on_break" }).label, "On break")
  assert.equal(availability(base).label, "Available")
})

test("clock and shift labels", () => {
  assert.equal(clockLabel("09:00:00"), "9 AM")
  assert.equal(clockLabel("13:30:00"), "1:30 PM")
  assert.equal(clockLabel("00:15:00"), "12:15 AM")
  assert.equal(
    shiftsLabel([
      { start: "17:00:00", end: "20:00:00" },
      { start: "09:00:00", end: "13:00:00" },
    ]),
    "9 AM - 1 PM, 5 PM - 8 PM",
  )
  assert.equal(shiftsLabel([]), "")
})

test("first name", () => {
  assert.equal(firstName("  Yash Dhanda "), "Yash")
  assert.equal(firstName(""), null)
  assert.equal(firstName(null), null)
})

test("days and slots read in the hospital's zone, not the server's", () => {
  // 20:00 UTC on the 25th is already 01:30 on the 26th in Kolkata.
  const now = new Date("2026-09-25T20:00:00Z")
  assert.equal(dayKey(now, "Asia/Kolkata"), "2026-09-26")
  assert.equal(slotLabel("2026-09-26T11:30:00Z", "Asia/Kolkata", now), "Today, 5:00 PM")
  assert.equal(slotLabel("2026-09-27T03:30:00Z", "Asia/Kolkata", now), "Tomorrow, 9:00 AM")
  assert.equal(slotLabel("2026-09-28T03:30:00Z", "Asia/Kolkata", now), "Mon 28 Sep, 9:00 AM")
})

test("initials skip the title", () => {
  assert.equal(initials("Dr. Neha Sharma"), "NS")
  assert.equal(initials("Dr Arjun Menon"), "AM")
  assert.equal(initials("Meera"), "M")
})

test("age turns over on the birthday itself", () => {
  assert.equal(ageOn("1966-09-26", "2026-09-26"), 60)
  assert.equal(ageOn("1966-09-27", "2026-09-26"), 59)
  assert.equal(ageOn("1966-10-01", "2026-09-26"), 59)
  assert.equal(ageOn("1990-01-15", "2026-09-26"), 36)
})

test("the clock decides outside a shift; the stored status only inside one", () => {
  const day = {
    ...base,
    status: "running_late",
    lateMinutes: 20,
    shifts: [
      { start: "17:00:00", end: "20:00:00" },
      { start: "09:00:00", end: "13:00:00" },
    ],
    breaks: [{ start: "11:00:00", end: "11:15:00" }],
  }
  assert.equal(availability({ ...day, nowTime: "06:30:00" }).label, "Opens at 9 AM")
  assert.equal(availability({ ...day, nowTime: "10:00:00" }).label, "Running late 20 min")
  assert.equal(availability({ ...day, nowTime: "11:05:00" }).label, "On a break until 11:15 AM")
  assert.equal(availability({ ...day, nowTime: "14:00:00" }).label, "Back at 5 PM")
  assert.equal(availability({ ...day, nowTime: "20:00:00" }).label, "Done for today, book for tomorrow")
  assert.equal(availability({ ...day, nowTime: "06:30:00" }).bookable, true)
  assert.equal(clockNow(new Date("2026-09-26T01:00:00Z"), "Asia/Kolkata"), "06:30:00")
})
