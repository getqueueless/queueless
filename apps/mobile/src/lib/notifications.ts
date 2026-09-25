import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deletePushToken, OWNED_BY_ANOTHER_ACCOUNT, type PushPlatform, savePushToken } from '@/lib/push-tokens';
import { supabase } from '@/lib/supabase';
import { getAlertsEnabled } from '@/lib/notification-preference';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// The token this install last saved, kept in storage so sign-out can delete exactly this row even
// after an app restart or a failed registration. The patient's other devices keep theirs.
const PUSH_TOKEN_KEY = 'queueless-push-token';

// The save in flight, so sign-out can let its upsert land before deleting the row.
let pendingSave: Promise<void> = Promise.resolve();

// Sign-out never waits longer than this on the network for push cleanup.
const SIGN_OUT_WAIT_MS = 3000;

// The device token behind the last registration. Every native device-token fetch also fires the
// push-token listener, so watchPushTokenRotation skips this echo instead of registering again.
let lastDeviceToken: string | null = null;

/**
 * Best-effort remote push registration; never throws. There is no token in Expo Go on Android
 * (no remote push since SDK 53), nor in any build without an EAS projectId:
 * `getExpoPushTokenAsync` throws ERR_NOTIFICATIONS_NO_EXPERIENCE_ID, and app.json has no
 * `extra.eas.projectId` yet. The token is saved straight to `push_tokens` under owner-only RLS.
 * This is a nice-to-have layered on top of the Realtime + local-notification path in
 * `(app)/_layout.tsx`, which is the reliable mechanism and works with zero push wiring.
 */
export async function registerForPushNotificationsAsync(userId: string): Promise<void> {
  // Queue alerts switched off in Profile: don't register this device for pushes.
  if (!getAlertsEnabled()) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let status = existingStatus;
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;

    pendingSave = saveDeviceToken(userId, await Notifications.getDevicePushTokenAsync());
    await pendingSave;
  } catch (err) {
    console.log('[push] no push token available:', err);
  }
}

/** Exchanges a device token for this app's Expo token and saves it to `push_tokens`. */
async function saveDeviceToken(userId: string, devicePushToken: Notifications.DevicePushToken): Promise<void> {
  lastDeviceToken = JSON.stringify(devicePushToken.data);
  // Passing the device token stops getExpoPushTokenAsync from fetching (and re-emitting) it.
  const { data: token } = await Notifications.getExpoPushTokenAsync({ devicePushToken });

  const code = await savePushToken(supabase, userId, token, Platform.OS as PushPlatform);
  if (code === null) {
    localStorage.setItem(PUSH_TOKEN_KEY, token);
  } else if (code === OWNED_BY_ANOTHER_ACCOUNT) {
    console.log('[push] token belongs to a different account on this device');
  } else {
    console.log(`[push] saving push token failed (non-fatal): ${code}`);
  }
}

/** Resolves with the promise's value, or with undefined once SIGN_OUT_WAIT_MS has passed. */
function within<T>(promise: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_WAIT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Deletes this device's token row. Call before sign-out: RLS only lets the owner delete it. Never
 * throws, and never holds sign-out up for longer than SIGN_OUT_WAIT_MS per network step.
 */
export async function unregisterPushTokenAsync(): Promise<void> {
  try {
    // Let an in-flight save land first, or its upsert could re-create the row after the delete.
    await within(pendingSave.catch(() => {}));
    const token = localStorage.getItem(PUSH_TOKEN_KEY);
    if (!token) return;
    // After this sign-out the stored token is no use: its row can only be deleted with this session.
    localStorage.removeItem(PUSH_TOKEN_KEY);
    if (!(await within(deletePushToken(supabase, token)))) {
      console.log('[push] no push_tokens row deleted (offline, or not this account\'s row)');
    }
  } catch (err) {
    console.log('[push] deleting push token failed (non-fatal):', err);
  }
}

/**
 * Re-registers when the OS rotates this device's token. Returns the unsubscribe, or a no-op when
 * unsupported. Expo's own auto-registration already forwards a rotated device token to Expo, so the
 * Expo token usually stays the same; this keeps the row right when it doesn't.
 */
export function watchPushTokenRotation(userId: string): () => void {
  try {
    // Throws in Expo Go on Android, which has no remote push. Use the event's own token: fetching
    // one in here would fire this event again, forever.
    const sub = Notifications.addPushTokenListener((devicePushToken) => {
      if (JSON.stringify(devicePushToken.data) === lastDeviceToken) return;
      pendingSave = saveDeviceToken(userId, devicePushToken);
      pendingSave.catch((err) => console.log('[push] saving rotated push token failed (non-fatal):', err));
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Fires an immediate local notification — the reliable fallback that works in Expo Go. */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  if (!getAlertsEnabled()) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}
