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

/**
 * Best-effort remote push registration. Returns `null` (never throws) whenever a token can't be
 * obtained — notably Expo Go on Android since SDK 53, which no longer supports remote push at
 * all, and any build without an EAS projectId: `getExpoPushTokenAsync` throws
 * ERR_NOTIFICATIONS_NO_EXPERIENCE_ID, and app.json has no `extra.eas.projectId` yet. The token
 * is saved straight to `push_tokens` under owner-only RLS. This is a nice-to-have layered on top
 * of the Realtime + local-notification path in `(app)/_layout.tsx`, which is the reliable
 * mechanism and works with zero push wiring.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
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
    if (status !== 'granted') return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    if (!token) return null;

    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return token;

    const code = await savePushToken(supabase, userId, token, Platform.OS as PushPlatform);
    if (code === null) {
      registeredToken = token;
    } else if (code === OWNED_BY_ANOTHER_ACCOUNT) {
      console.log('[push] token belongs to a different account on this device');
    } else {
      console.log(`[push] saving push token failed (non-fatal): ${code}`);
    }
    return token;
  } catch (err) {
    console.log('[notifications] no push token available:', err);
    return null;
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

/** Re-registers when the OS rotates the token. Returns the unsubscribe (a no-op when unsupported). */
export function watchPushTokenRotation(): () => void {
  try {
    // Throws in Expo Go on Android, which has no remote push.
    const sub = Notifications.addPushTokenListener(() => {
      registerForPushNotificationsAsync();
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
