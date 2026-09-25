// Run from apps/web: node --experimental-strip-types --test src/app/_landing/token-id.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"

import { extractTokenId } from "./token-id.ts"

const ID = "1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d"

test("accepts the bare id or the slip's status link", () => {
  assert.equal(extractTokenId(ID), ID)
  assert.equal(extractTokenId(`  ${ID.toUpperCase()}  `), ID)
  assert.equal(extractTokenId(`https://lpu.lol/t/${ID}`), ID)
  assert.equal(extractTokenId(`lpu.lol/t/${ID}/?from=slip`), ID)
})

test("rejects anything else", () => {
  for (const bad of ["", "OPD-012", `${ID}x`, `https://lpu.lol/admin/${ID}`, `/t/${ID} /t/../x`, ID.slice(1)]) {
    assert.equal(extractTokenId(bad), null, bad)
  }
})
