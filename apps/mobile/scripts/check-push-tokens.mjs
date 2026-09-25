// Proves the push_tokens contract the app relies on (upsert idempotency, owner-only RLS, delete)
// by running the shipped src/lib/push-tokens.ts against a live Supabase with two real users.
// Run from the repo root: SUPABASE_URL=… SUPABASE_ANON_KEY=… JWT_A=… JWT_B=… node --experimental-strip-types apps/mobile/scripts/check-push-tokens.mjs
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';

import { deletePushToken, OWNED_BY_ANOTHER_ACCOUNT, savePushToken } from '../src/lib/push-tokens.ts';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const JWT_A = process.env.JWT_A;
const JWT_B = process.env.JWT_B;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !JWT_A || !JWT_B) {
  console.error('usage: SUPABASE_URL=… SUPABASE_ANON_KEY=… JWT_A=… JWT_B=… node --experimental-strip-types apps/mobile/scripts/check-push-tokens.mjs');
  process.exit(2);
}

const clientFor = (jwt) =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + jwt } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
const subOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub;

const a = clientFor(JWT_A);
const b = clientFor(JWT_B);
const userA = subOf(JWT_A);
const userB = subOf(JWT_B);
const token = 'ExponentPushToken[check-' + Date.now().toString(36) + ']';
const spoof = token.replace(']', '-spoof]');

async function rowsFor(client, expoToken = token) {
  const { data, error } = await client.from('push_tokens').select('user_id, platform').eq('expo_token', expoToken);
  assert.equal(error, null);
  return data;
}

try {
  assert.equal(await savePushToken(a, userA, token, 'android'), null);
  assert.deepEqual(await rowsFor(a), [{ user_id: userA, platform: 'android' }]);
  console.log('PASS 1: A saves the token');

  // user_id is client-supplied, so WITH CHECK must stop B planting a row under A, and SELECT must
  // hide A's token from B (an Expo token is enough to push to A's phone).
  assert.equal(await savePushToken(b, userA, spoof, 'ios'), OWNED_BY_ANOTHER_ACCOUNT);
  assert.deepEqual(await rowsFor(b), []);
  console.log("PASS 1b: B can neither insert a row as A nor read A's row");

  assert.equal(await savePushToken(a, userA, token, 'android'), null);
  console.log('PASS 2: A re-saves the same token (no 23505)');

  assert.equal(await savePushToken(b, userB, token, 'ios'), OWNED_BY_ANOTHER_ACCOUNT);
  console.log('PASS 3: B saving the same token gets 42501');

  assert.equal(await deletePushToken(b, token), false);
  assert.equal((await rowsFor(a)).length, 1);
  console.log("PASS 4: B's delete leaves A's row intact");

  assert.equal(await deletePushToken(a, token), true);
  console.log("PASS 5: A's delete succeeds");

  assert.equal((await rowsFor(a)).length, 0);
  console.log('PASS 6: the row is gone');
} catch (err) {
  console.error('FAIL:', err);
  process.exitCode = 1;
} finally {
  // If B ever did take the row over, only B can delete it, so clean up as both.
  for (const client of [a, b]) for (const t of [token, spoof]) await deletePushToken(client, t);
  const left = [...(await rowsFor(a)), ...(await rowsFor(b)), ...(await rowsFor(a, spoof)), ...(await rowsFor(b, spoof))];
  if (left.length) {
    console.error('FAIL: leftover push_tokens rows:', left);
    process.exitCode = 1;
  }
}
