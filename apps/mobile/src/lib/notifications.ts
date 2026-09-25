import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Best-effort remote push registration. Returns `null` (never throws) whenever a token can't be
 * obtained — notably Expo Go on Android since SDK 53, which no longer supports remote push at
 * all. This is a nice-to-have layered on top of the Realtime + local-notification path in
 * `(app)/_layout.tsx`, which is the reliable mechanism and works with zero push wiring.
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

    await registerTokenWithApi(token);
    return token;
  } catch (err) {
    console.log('[notifications] no push token available:', err);
    return null;
  }
}

async function registerTokenWithApi(expoPushToken: string): Promise<void> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) return;

    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return;

    await fetch(`${apiUrl}/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ expo_push_token: expoPushToken }),
    });
  } catch (err) {
    // API may not be up yet — never let this block the caller.
    console.log('[notifications] push/register failed (non-fatal):', err);
  }
}

/** Fires an immediate local notification — the reliable fallback that works in Expo Go. */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}
