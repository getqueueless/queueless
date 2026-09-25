import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedHeading } from '@/components/AnimatedHeading';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { estimateWaitSeconds } from '@/lib/predict';
import { todayDateString } from '@/lib/service-day';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';

// Confirmed against supabase/migrations/0003_services_counters.sql and
// 0006_boards_notifications_audit.sql (landed after this screen's first draft): `services` has
// `default_service_secs`, not `avg_service_secs`. `board_services` is keyed by
// `(service_id, day)` — must filter to today — and has `waiting_count`/`avg_service_secs`
// (nullable until a service has served anyone today) but NO `open_counters` column at all;
// that's computed client-side from `counter_services` joined to `counters.state`.
type Service = { id: string; name: string; is_open: boolean; default_service_secs: number };
type BoardServiceRow = { service_id: string; waiting_count: number; avg_service_secs: number | null };
type BoardService = { waiting_count: number; avg_service_secs: number; open_counters: number };

const EMPTY_BOARD_ROW: BoardService = { waiting_count: 0, avg_service_secs: 0, open_counters: 0 };

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
 * per-doctor booking list from the same screen, so there's one picker, not two.
 */
export default function TakeToken() {
  const theme = useTheme();
  const router = useRouter();

  const [services, setServices] = useState<Service[]>([]);
  const [boardRows, setBoardRows] = useState<Record<string, BoardServiceRow>>({});
  const [openCounters, setOpenCounters] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // No realtime here: docs/API_CONTRACT.md's "Realtime topics" section confirms the self-hosted
  // `supabase_realtime` publication has zero member tables, so a `postgres_changes` listener on
  // `board_services` would silently receive nothing (a prior version of this screen carried one
  // — it never fired). `board_services`/`board_counters` aren't covered by that migration's
  // broadcast fix either (tokens only), so `useLiveRefresh`'s refetch-on-focus + 10s poll below
  // is the actual live-update mechanism here, not a fallback on top of one.
  const load = useCallback(async () => {
    const today = todayDateString();
    try {
      const [servicesRes, boardRes, counterRes] = await Promise.all([
        supabase.from('services').select('*').eq('is_open', true),
        supabase.from('board_services').select('service_id, waiting_count, avg_service_secs').eq('day', today),
        // No `open_counters` column exists anywhere — derive it from which counters serving
        // each service are currently open. Refreshed on load/reconnect, not on every
        // waiting_count tick (counters opening/closing is rare by comparison).
        supabase.from('counter_services').select('service_id, counters(state)'),
      ]);
      if (servicesRes.error) throw servicesRes.error;
      if (boardRes.error) throw boardRes.error;
      if (counterRes.error) throw counterRes.error;

      const nextBoardRows: Record<string, BoardServiceRow> = {};
      for (const row of (boardRes.data ?? []) as BoardServiceRow[]) {
        nextBoardRows[row.service_id] = row;
      }

      // Without generated Database types, supabase-js can't tell this embed is many-to-one
      // (counter_services.counter_id -> counters.id) — it infers `counters` as an array even
      // though PostgREST returns a single object at runtime. Handle both shapes defensively.
      const nextOpenCounters: Record<string, number> = {};
      for (const row of (counterRes.data ?? []) as unknown as {
        service_id: string;
        counters: { state: string } | { state: string }[] | null;
      }[]) {
        const counter = Array.isArray(row.counters) ? row.counters[0] : row.counters;
        if (counter?.state === 'open') {
          nextOpenCounters[row.service_id] = (nextOpenCounters[row.service_id] ?? 0) + 1;
        }
      }

      setServices((servicesRes.data ?? []) as Service[]);
      setBoardRows(nextBoardRows);
      setOpenCounters(nextOpenCounters);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load services right now — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useLiveRefresh(load, 10_000);

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
                boardRow={{
                  waiting_count: boardRows[service.id]?.waiting_count ?? EMPTY_BOARD_ROW.waiting_count,
                  avg_service_secs: boardRows[service.id]?.avg_service_secs ?? service.default_service_secs,
                  open_counters: openCounters[service.id] ?? EMPTY_BOARD_ROW.open_counters,
                }}
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
