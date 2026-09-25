import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deletePushToken, OWNED_BY_ANOTHER_ACCOUNT, type PushPlatform, savePushToken } from '@/lib/push-tokens';
import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// The token this install last saved. Sign-out deletes exactly this row, so the patient's other
// devices keep theirs.
let registeredToken: string | null = null;

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

    await saveDeviceToken(userId, await Notifications.getDevicePushTokenAsync());
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
    registeredToken = token;
  } else if (code === OWNED_BY_ANOTHER_ACCOUNT) {
    console.log('[push] token belongs to a different account on this device');
  } else {
    console.log(`[push] saving push token failed (non-fatal): ${code}`);
  }
}

/** Deletes this device's token row. Call before sign-out: RLS only lets the owner delete it. */
export async function unregisterPushTokenAsync(): Promise<void> {
  if (!registeredToken) return;
  try {
    if (await deletePushToken(supabase, registeredToken)) registeredToken = null;
    else console.log('[push] deleting push token failed (non-fatal)');
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
      saveDeviceToken(userId, devicePushToken).catch((err) =>
        console.log('[push] saving rotated push token failed (non-fatal):', err),
      );
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}

/** Fires an immediate local notification — the reliable fallback that works in Expo Go. */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}
