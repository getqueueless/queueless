import { Redirect, Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { NotificationBanner } from '@/components/NotificationBanner';
import { OfflineBanner } from '@/components/OfflineBanner';
import { useTheme } from '@/hooks/use-theme';
import { registerForPushNotificationsAsync, showLocalNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/use-session';

/**
 * `notifications` columns beyond `patient_id` aren't fully enumerated in supabase/README.md —
 * assuming `id`, `kind`, `read_at` (nullable), `token_id` per the task brief. There's no
 * title/body column assumed, so banner copy is derived from `kind` here.
 */
type NotificationRow = {
  id: string;
  kind: string | null;
  token_id: string | null;
  read_at: string | null;
};

function describeNotification(kind: string | null | undefined): { title: string; body: string } | null {
  const k = (kind ?? '').toLowerCase();
  if (k.includes('called')) return { title: "You've been called", body: 'Please head to the counter now.' };
  if (k.includes('almost')) return { title: "You're almost up", body: 'Your turn is coming soon — stay nearby.' };
  return null;
}

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

  const [banner, setBanner] = useState<{ row: NotificationRow; title: string; body: string } | null>(null);

  const handleRow = useCallback((row: NotificationRow) => {
    if (row.read_at) return;
    const desc = describeNotification(row.kind);
    if (!desc) return;
    setBanner({ row, ...desc });
    showLocalNotification(desc.title, desc.body).catch(() => {});
  }, []);

  const refetch = useCallback(async () => {
    if (!userId) return;
    // Realtime never replays missed events — refetch the latest unread row on (re)connect/foreground.
    const { data } = await supabase
      .from('notifications')
      .select('id, kind, token_id, read_at')
      .eq('patient_id', userId)
      .is('read_at', null)
      .order('id', { ascending: false })
      .limit(1);
    const row = data?.[0] as NotificationRow | undefined;
    if (row) handleRow(row);
  }, [userId, handleRow]);

  useEffect(() => {
    if (!session) return;
    registerForPushNotificationsAsync().catch(() => {});
  }, [session]);

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
  if (!session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <>
      <OfflineBanner />
      <NotificationBanner
        visible={!!banner}
        title={banner?.title ?? ''}
        body={banner?.body ?? ''}
        onPress={() => {
          if (!banner) return;
          markNotificationRead(banner.row.id);
          const tokenId = banner.row.token_id;
          setBanner(null);
          if (tokenId) router.push(`/(app)/token/${tokenId}`);
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
      </Stack>
    </>
  );
}
