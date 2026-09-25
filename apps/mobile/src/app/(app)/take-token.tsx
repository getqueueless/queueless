import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedHeading } from '@/components/AnimatedHeading';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { estimateWaitSeconds } from '@/lib/predict';
import { useDepartmentBoard, type BoardService, type Service } from '@/lib/use-department-board';

function formatWait(seconds: number): string {
  if (seconds <= 0) return 'No wait';
  if (seconds < 60) return '< 1 min';
  return `~${Math.round(seconds / 60)} min`;
}

function ServiceCard({
  service,
  boardRow,
  index,
  onPress,
}: {
  service: Service;
  boardRow: BoardService;
  index: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const localEstimate = estimateWaitSeconds(boardRow.waiting_count, boardRow.avg_service_secs, boardRow.open_counters);
  const [predictedSeconds, setPredictedSeconds] = useState<number | null>(null);

  // Best-effort prediction upgrade — never blocks first paint, which already shows localEstimate.
  useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) return;
    let cancelled = false;

    const now = new Date();
    // apps/api's training data uses weekday 0 = Monday; JS Date#getDay() uses 0 = Sunday.
    const weekday = (now.getDay() + 6) % 7;

    fetch(`${apiUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: service.id,
        hour: now.getHours(),
        weekday,
        queue_len_ahead: boardRow.waiting_count,
        counters_open: Math.max(boardRow.open_counters, 1),
      }),
      signal: AbortSignal.timeout(1500),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('predict: bad status'))))
      .then((body) => {
        if (!cancelled && typeof body?.predicted_wait_minutes === 'number') {
          setPredictedSeconds(Math.round(body.predicted_wait_minutes * 60));
        }
      })
      .catch(() => {
        // Any failure/timeout/missing URL/unknown-for-today service — the local estimate
        // already on screen is enough.
      });

    return () => {
      cancelled = true;
    };
  }, [service.id, service.name, boardRow.waiting_count, boardRow.open_counters]);

  const waitSeconds = predictedSeconds ?? localEstimate;
  const label = predictedSeconds !== null ? 'predicted' : 'estimate';
  const numberLabel = String(index + 1).padStart(2, '0');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        CardShadow,
        { backgroundColor: theme.surface, borderColor: theme.hairline, opacity: pressed ? 0.85 : 1 },
      ]}>
      <ThemedText type="displayLg" themeColor="primaryDisplay" style={styles.cardNumber}>
        {numberLabel}
      </ThemedText>
      <ThemedText type="headingMd" style={styles.cardHeading}>
        {service.name}
      </ThemedText>
      <View
        style={[
          styles.cardBadge,
          { backgroundColor: theme.primarySoft, borderColor: theme.primaryOutline },
        ]}>
        <ThemedText type="caption" themeColor="inkSecondary">
          {boardRow.waiting_count} waiting · {formatWait(waitSeconds)} ({label})
        </ThemedText>
      </View>
    </Pressable>
  );
}

/**
 * The service picker shared by both "Take a token" and "Book appointment" on the Home hub —
 * `(app)/department/[serviceId].tsx` offers both a walk-in "Any available" token and a
 * per-doctor booking list from the same screen, so there's one picker, not two. Home's own
 * "Departments" grid (DeptTile) uses the same `useDepartmentBoard` hook for its live waits;
 * this is the fuller list view for the quick-action entry point.
 */
export default function TakeToken() {
  const theme = useTheme();
  const router = useRouter();
  const { services, board, loading, loadError } = useDepartmentBoard();

  return (
    <ThemedView type="canvas" style={styles.container}>
      <Stack.Screen options={{ title: 'Take a token' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <AnimatedHeading text="TAKE A TOKEN" accent="TOKEN" style={styles.title} />
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          Tap a service to take a token or book with a doctor.
        </ThemedText>

        {loading ? (
          <View style={styles.centerFill}>
            <View style={[styles.stateCard, CardShadow, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
              <ActivityIndicator color={theme.primary} />
            </View>
          </View>
        ) : loadError ? (
          <View style={styles.centerFill}>
            <View style={[styles.stateCard, CardShadow, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
              <ThemedText type="body" themeColor="inkMuted" style={styles.emptyText}>
                {loadError}
              </ThemedText>
            </View>
          </View>
        ) : services.length === 0 ? (
          <View style={styles.centerFill}>
            <View style={[styles.stateCard, CardShadow, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
              <ThemedText type="body" themeColor="inkMuted" style={styles.emptyText}>
                No services are open right now. Check back soon.
              </ThemedText>
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {services.map((service, index) => (
              <ServiceCard
                key={service.id}
                service={service}
                index={index}
                boardRow={board[service.id] ?? { waiting_count: 0, avg_service_secs: service.default_service_secs, open_counters: 0 }}
                onPress={() => router.push({ pathname: '/(app)/department/[serviceId]', params: { serviceId: service.id } })}
              />
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  title: { marginTop: Spacing.sm },
  subtitle: { marginTop: Spacing.xxs, marginBottom: Spacing.md },
  list: { paddingBottom: Spacing.xl, gap: Spacing.md },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateCard: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Spacing.lg,
  },
  emptyText: { textAlign: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
    minHeight: 44,
    gap: Spacing.xxs,
  },
  cardNumber: { fontSize: 40, lineHeight: 40, opacity: 0.18 },
  cardHeading: { marginTop: -Spacing.xs },
  cardBadge: {
    borderWidth: 1,
    borderRadius: Rounded.pill,
    paddingVertical: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    alignSelf: 'flex-start',
    marginTop: Spacing.xxs,
  },
});
