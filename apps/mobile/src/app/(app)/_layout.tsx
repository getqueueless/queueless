import { Redirect, Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { NotificationBanner } from '@/components/NotificationBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useTheme } from '@/hooks/use-theme';
import {
  registerForPushNotificationsAsync,
  showLocalNotification,
  watchPushTokenRotation,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/use-session';

// Confirmed against supabase/migrations/0006_boards_notifications_audit.sql: `notifications`
// has real `title`/`body` columns (both NOT NULL) — use the server's own copy directly instead
// of re-deriving text from `kind`. `kind` is constrained to a fixed check-list (`called`,
// `almost_turn`, `no_show`, `expired`, `appointment_reminder`); every kind gets a banner here,
// not just called/almost_turn, since the server already wrote appropriate title/body for each.
type NotificationRow = {
  id: string;
  title: string;
  body: string;
  token_id: string | null;
  read_at: string | null;
};

async function markNotificationRead(id: string) {
  try {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  } catch (err) {
    console.log('[notifications] mark-read failed (non-fatal):', err);
  }
}

export default function AppLayout() {
  const { session, loading } = useSession();
  const theme = useTheme();
  const router = useRouter();
  const userId = session?.user?.id;

  const [banner, setBanner] = useState<NotificationRow | null>(null);

  const handleRow = useCallback((row: NotificationRow) => {
    if (row.read_at) return;
    setBanner(row);
    showLocalNotification(row.title, row.body).catch(() => {});
  }, []);

  const refetch = useCallback(async () => {
    if (!userId) return;
    // Realtime never replays missed events — refetch the latest unread row on (re)connect/foreground.
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, token_id, read_at')
      .eq('patient_id', userId)
      .is('read_at', null)
      .order('id', { ascending: false })
      .limit(1);
    const row = data?.[0] as NotificationRow | undefined;
    if (row) handleRow(row);
  }, [userId, handleRow]);

  useEffect(() => {
    if (!userId) return;
    registerForPushNotificationsAsync(userId);
    return watchPushTokenRotation(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `patient_id=eq.${userId}` },
        (payload) => handleRow(payload.new as NotificationRow),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refetch();
      });

    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refetch();
    });

    return () => {
      supabase.removeChannel(channel);
      appStateSub.remove();
    };
  }, [userId, handleRow, refetch]);

  if (loading) return null;
  if (!session) return <Redirect href="/(auth)" />;

  return (
    <>
      <OfflineBanner />
      <NotificationBanner
        visible={!!banner}
        title={banner?.title ?? ''}
        body={banner?.body ?? ''}
        onPress={() => {
          if (!banner) return;
          markNotificationRead(banner.id);
          const tokenId = banner.token_id;
          setBanner(null);
          if (tokenId) router.push({ pathname: '/(app)/token/[id]', params: { id: tokenId } });
        }}
        onDismiss={() => setBanner(null)}
      />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.ink,
          headerShadowVisible: false,
        }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="token/[id]" options={{ title: 'Your ticket' }} />
        <Stack.Screen name="name-entry" options={{ headerShown: false, gestureEnabled: false }} />
      </Stack>
    </>
  );
}
