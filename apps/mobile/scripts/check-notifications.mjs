// Runs src/lib/notifications.ts in plain Node with expo-notifications, react-native and the
// Supabase modules stubbed, to check two things device testing can't reach yet (no EAS projectId):
// the token-rotation listener must not re-trigger itself, and sign-out must delete the token a
// previous launch saved. Run from the repo root:
//   node --experimental-strip-types apps/mobile/scripts/check-notifications.mjs
import assert from 'node:assert/strict';
import { register } from 'node:module';

const STUBBED = {
  'expo-notifications': [
    'setNotificationHandler',
    'setNotificationChannelAsync',
    'AndroidImportance',
    'getPermissionsAsync',
    'requestPermissionsAsync',
    'getDevicePushTokenAsync',
    'getExpoPushTokenAsync',
    'addPushTokenListener',
    'scheduleNotificationAsync',
  ],
  'react-native': ['Platform'],
  '@/lib/supabase': ['supabase'],
  '@/lib/push-tokens': ['savePushToken', 'deletePushToken', 'OWNED_BY_ANOTHER_ACCOUNT'],
};
register(
  'data:text/javascript,' +
    encodeURIComponent(`const names = ${JSON.stringify(STUBBED)};
export async function resolve(s, c, next) { return names[s] ? { url: 'stub:' + s, shortCircuit: true } : next(s, c); }
export async function load(u, c, next) {
  if (!u.startsWith('stub:')) return next(u, c);
  const s = u.slice(5);
  const source = names[s].map((n) => 'export const ' + n + ' = globalThis.__stubs[' + JSON.stringify(s) + '].' + n + ';').join('\\n');
  return { format: 'module', shortCircuit: true, source };
}`),
);

const EXPO_TOKEN = 'ExponentPushToken[device-1]';
const DEVICE_TOKEN = { type: 'ios', data: 'apns-1' };
const state = { online: true, expoCalls: 0, saved: [], deleted: [] };
const listeners = new Set();
// expo-notifications 57 emits the push-token event after every native device-token fetch
// (iOS PushTokenModule.didRegister, Android onNewToken). Passing devicePushToken skips the fetch.
const fetchDeviceToken = () => {
  setImmediate(() => listeners.forEach((l) => l(DEVICE_TOKEN)));
  return DEVICE_TOKEN;
};
globalThis.__stubs = {
  'expo-notifications': {
    setNotificationHandler() {},
    setNotificationChannelAsync: async () => {},
    AndroidImportance: { HIGH: 4 },
    getPermissionsAsync: async () => ({ status: 'granted' }),
    requestPermissionsAsync: async () => ({ status: 'granted' }),
    getDevicePushTokenAsync: async () => fetchDeviceToken(),
    getExpoPushTokenAsync: async (options = {}) => {
      state.expoCalls++;
      if (!options.devicePushToken) fetchDeviceToken();
      if (!state.online) throw new Error('ERR_NOTIFICATIONS_NETWORK_ERROR');
      return { type: 'expo', data: EXPO_TOKEN };
    },
    addPushTokenListener: (listener) => (listeners.add(listener), { remove: () => listeners.delete(listener) }),
    scheduleNotificationAsync: async () => {},
  },
  'react-native': { Platform: { OS: 'ios' } },
  '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: 'user-a' } } } }) } } },
  '@/lib/push-tokens': {
    savePushToken: async (_client, _userId, token) => (state.saved.push(token), null),
    deletePushToken: async (_client, token) => (state.deleted.push(token), true),
    OWNED_BY_ANOTHER_ACCOUNT: '42501',
  },
};
// expo-sqlite's localStorage survives an app restart; module state does not.
const disk = new Map();
globalThis.localStorage = {
  getItem: (k) => disk.get(k) ?? null,
  setItem: (k, v) => disk.set(k, String(v)),
  removeItem: (k) => disk.delete(k),
};
const turns = async (n) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
// A fresh module instance per "launch" = a cold start.
const launch = (n) => import(new URL('../src/lib/notifications.ts', import.meta.url).href + '?launch=' + n);

// 1. Same order as (app)/_layout.tsx: register, then watch for rotation.
const first = await launch(1);
first.registerForPushNotificationsAsync('user-a');
const stop = first.watchPushTokenRotation('user-a');
await turns(50);
stop();
await turns(3);
assert.ok(state.expoCalls <= 2, `rotation listener re-entered registration ${state.expoCalls} times`);
console.log(`PASS: registration ran ${state.expoCalls} time(s), no listener loop`);

// 2. A rotated device token is saved once, from the event's own token.
listeners.clear();
const rotating = await launch(2);
await rotating.registerForPushNotificationsAsync('user-a');
const registered = state.expoCalls;
const unwatch = rotating.watchPushTokenRotation('user-a');
await turns(3);
assert.equal(state.expoCalls, registered, "the registration's own echo event should be skipped");
const before = state.expoCalls;
listeners.forEach((l) => l({ type: 'ios', data: 'apns-2' }));
await turns(10);
unwatch();
assert.equal(state.expoCalls - before, 1, 'a rotated token should be exchanged exactly once');
console.log('PASS: a rotated device token is re-registered once');

// 3. Sign-out after a cold start whose registration failed still deletes the saved token.
const cold = await launch(3);
state.online = false;
await cold.registerForPushNotificationsAsync('user-a');
state.online = true;
state.deleted.length = 0;
await cold.unregisterPushTokenAsync();
assert.deepEqual(state.deleted, [EXPO_TOKEN], "sign-out left this device's push_tokens row");
await cold.unregisterPushTokenAsync();
assert.deepEqual(state.deleted, [EXPO_TOKEN], 'a second sign-out should find nothing left to delete');
console.log("PASS: sign-out deletes the previous launch's token, once");
