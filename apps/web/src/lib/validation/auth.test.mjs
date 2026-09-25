// Run from apps/web: node --experimental-strip-types --test src/lib/validation/auth.test.mjs
import assert from "node:assert/strict"
import { test } from "node:test"

import { profileSchema } from "./auth.ts"

const base = {
  fullName: "Test Patient",
  dateOfBirth: "1990-01-01",
  gender: "other",
  city: "Delhi",
  addressLine: "",
}

test("a bare 10-digit number that starts with 91 is not mistaken for a country-code prefix", () => {
  const result = profileSchema.safeParse({ ...base, phone: "9123456789" })
  assert.equal(result.success, true)
  assert.equal(result.data.phone, "+919123456789")
})

test("a 12-digit number with a real 91 country-code prefix still strips it", () => {
  const result = profileSchema.safeParse({ ...base, phone: "919876543210" })
  assert.equal(result.success, true)
  assert.equal(result.data.phone, "+919876543210")
})

test("an ordinary 10-digit number normalizes the same way", () => {
  const result = profileSchema.safeParse({ ...base, phone: "9876543210" })
  assert.equal(result.success, true)
  assert.equal(result.data.phone, "+919876543210")
})

test("too few digits still fails validation", () => {
  const result = profileSchema.safeParse({ ...base, phone: "12345" })
  assert.equal(result.success, false)
})
