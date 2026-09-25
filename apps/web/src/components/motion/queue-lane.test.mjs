// Run from apps/web: node --experimental-strip-types --test src/components/motion/queue-lane.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"

import { freshLane, moveLane, stageOf } from "./queue-lane.ts"

const ids = (lane) => lane.dots.map((d) => d.id)

test("a call takes the front dot out and moves everyone up", () => {
  const lane = moveLane(freshLane(3), 2)
  assert.deepEqual(lane.leaving.map((d) => d.id), [0])
  assert.deepEqual(ids(lane), [1, 2])
  assert.deepEqual(lane.dots.map((d) => d.i), [0, 1])
  assert.equal(lane.added, 0)
})

test("past eight, the line refills from the back", () => {
  const lane = moveLane(freshLane(12), 10)
  assert.equal(lane.dots.length, 8)
  assert.deepEqual(lane.leaving.map((d) => d.id), [0, 1])
  assert.deepEqual(lane.dots.slice(-2).map((d) => d.enter), ["back", "back"])
})

test("a priority arrival drops in at the front and is reported", () => {
  const lane = moveLane(freshLane(2), 3)
  assert.equal(lane.added, 1)
  assert.equal(lane.dots[0].enter, "front")
  assert.deepEqual(ids(lane).slice(1), [0, 1])
  // The next call clears the note.
  assert.equal(moveLane(lane, 2).added, 0)
})

test("unknown position resets without motion", () => {
  assert.deepEqual(moveLane(freshLane(4), null).dots, [])
  assert.equal(moveLane(freshLane(null), 3).leaving.length, 0)
})

test("DB status maps onto the five stages", () => {
  assert.equal(stageOf("pending_payment", null), 0)
  assert.equal(stageOf("waiting", 4), 1)
  assert.equal(stageOf("waiting", null), 1)
  assert.equal(stageOf("waiting", 0), 2)
  assert.equal(stageOf("called", 0), 3)
  assert.equal(stageOf("serving", null), 3)
  assert.equal(stageOf("done", null), 4)
  assert.equal(stageOf("no_show", null), 4)
})
