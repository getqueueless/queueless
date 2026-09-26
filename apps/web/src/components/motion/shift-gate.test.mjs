// Run from apps/web: node --experimental-strip-types --test src/components/motion/shift-gate.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"

import { clock12, shiftGate } from "./shift-gate.ts"

const day = [
  { start_time: "17:00:00", end_time: "20:00:00" },
  { start_time: "09:00:00", end_time: "13:00:00" },
]
const at = (h, m = 0) => h * 60 + m

test("before, during, between, after", () => {
  assert.deepEqual(shiftGate(day, at(8, 30)), { kind: "before", at: "9:00 AM" })
  assert.equal(shiftGate(day, at(10)), null)
  assert.deepEqual(shiftGate(day, at(14)), { kind: "between", at: "5:00 PM" })
  assert.equal(shiftGate(day, at(18)), null)
  assert.equal(shiftGate(day, at(21)), null)
  assert.equal(shiftGate([], at(8)), null)
})

test("12-hour clock", () => {
  assert.equal(clock12("00:30:00"), "12:30 AM")
  assert.equal(clock12("12:00:00"), "12:00 PM")
})
