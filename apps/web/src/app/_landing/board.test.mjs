// Run from apps/web: node --experimental-strip-types --test src/app/_landing/board.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"

import { estimateWaitMins } from "./board.ts"

const row = (service_id, waiting_count, avg_service_secs) => ({ service_id, waiting_count, avg_service_secs })

test("people waiting x average visit / open counters, averaged over queues", () => {
  // OPD: 6 x 379s / 2 counters = 1137s; PHA: 6 x 166s / 1 = 996s; mean 1066.5s = 18 min.
  assert.equal(estimateWaitMins([row("opd", 6, 379), row("pha", 6, 166), row("ort", 0, 759)], { opd: 2, pha: 1 }), 18)
})

test("nobody waiting anywhere is zero, not unknown", () => {
  assert.equal(estimateWaitMins([row("opd", 0, 379)], {}), 0)
  assert.equal(estimateWaitMins([], {}), 0)
})

test("a queue with no open counter or no average is left out, never guessed", () => {
  assert.equal(estimateWaitMins([row("opd", 4, 300)], {}), null)
  assert.equal(estimateWaitMins([row("opd", 4, null)], { opd: 1 }), null)
  assert.equal(estimateWaitMins([row("opd", 4, 300), row("pha", 3, null)], { opd: 2, pha: 1 }), 10)
})

test("a short queue still reads at least 1 minute", () => {
  assert.equal(estimateWaitMins([row("opd", 1, 20)], { opd: 3 }), 1)
})
