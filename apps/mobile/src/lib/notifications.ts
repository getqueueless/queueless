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

const DEVICE_ID_KEY = 'queueless-device-id';

/** A stable per-install id for apps/api's `push_tokens.device_id` — persisted in the same
 * expo-sqlite-backed localStorage the Supabase client already uses for its session. */
function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}

async function registerTokenWithApi(expoPushToken: string): Promise<void> {
  try {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) return;

    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return;

    // apps/api's real endpoint: POST /push-tokens, body {token, device_id}, 204 on success.
    await fetch(`${apiUrl}/push-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token: expoPushToken, device_id: getOrCreateDeviceId() }),
    });
  } catch (err) {
    // API may not be up yet — never let this block the caller.
    console.log('[notifications] push-tokens registration failed (non-fatal):', err);
  }
}

/** Fires an immediate local notification — the reliable fallback that works in Expo Go. */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}
