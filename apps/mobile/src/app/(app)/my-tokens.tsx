import { Stack, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRequireCompleteProfile } from '@/lib/use-require-complete-profile';

type Embed<T> = T | T[] | null;

type TokenRow = {
  id: string;
  code: string;
  service_id: string;
  status: string;
  services: Embed<{ name: string }>;
};

type ActiveToken = { id: string; code: string; serviceId: string; status: string; serviceName: string };

// Same set `(tabs)/history.tsx` treats as resolved -- everything else is still "in play".
const ACTIVE_STATUSES = ['pending_payment', 'waiting', 'called', 'serving'];

const STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Waiting for payment',
  waiting: 'Waiting',
  called: "You've been called",
  serving: 'Now serving you',
};

function one<T>(embed: Embed<T>): T | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

export default function MyTokens() {
  const theme = useTheme();
  const router = useRouter();
  const ready = useRequireCompleteProfile();

  const [tokens, setTokens] = useState<ActiveToken[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id;
    if (!patientId) return;

    const { data, error } = await supabase
      .from('tokens')
      .select('id, code, service_id, status, services(name)')
      .eq('patient_id', patientId)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false });

    if (error) {
      setLoadError(mapSupabaseError({ code: error.code, message: error.message }));
      return;
    }

    setTokens(
      ((data ?? []) as unknown as TokenRow[]).map((row) => ({
        id: row.id,
        code: row.code,
        serviceId: row.service_id,
        status: row.status,
        serviceName: one(row.services)?.name ?? 'Queue ticket',
      })),
    );
    setLoadError(null);
  }, []);

  useLiveRefresh(refetch, 10_000);

  if (!ready) return null;

  return (
    <ThemedView type="canvas" style={styles.container}>
      <Stack.Screen options={{ title: 'My active tokens' }} />
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.list}>
          {tokens === null && !loadError ? (
            <View style={styles.centerFill}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : loadError ? (
            <View style={[styles.stateCard, CardShadow, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
              <ThemedText type="body" themeColor="inkMuted" style={styles.centerText}>
                {loadError}
              </ThemedText>
            </View>
          ) : tokens && tokens.length === 0 ? (
            <View style={[styles.stateCard, CardShadow, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
              <ThemedText type="body" themeColor="inkMuted" style={styles.centerText}>
                No active tokens right now. Take one from Home.
              </ThemedText>
            </View>
          ) : (
            tokens?.map((token) => (
              <Pressable
                key={token.id}
                onPress={() =>
                  router.push({ pathname: '/(app)/token/[id]', params: { id: token.id, serviceId: token.serviceId } })
                }
                style={({ pressed }) => [
                  styles.card,
                  CardShadow,
                  { backgroundColor: theme.surface, borderColor: theme.hairline, opacity: pressed ? 0.85 : 1 },
                ]}>
                <ThemedText type="tokenNumber">{token.code}</ThemedText>
                <ThemedText type="body" themeColor="inkSecondary">
                  {token.serviceName}
                </ThemedText>
                <ThemedText type="bodySm" themeColor="primaryText">
                  {STATUS_LABEL[token.status] ?? token.status}
                </ThemedText>
              </Pressable>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: Spacing.xxl },
  centerText: { textAlign: 'center' },
  list: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  stateCard: {
    borderWidth: 1,
    borderRadius: Rounded.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
    gap: Spacing.xxs,
  },
});
