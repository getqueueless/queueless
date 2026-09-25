import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { estimateWaitSeconds } from '@/lib/predict';
import { supabase } from '@/lib/supabase';

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

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// apps/api's /predict only knows this fixed 5-service Hospital OPD demo preset (see
// apps/api/app/routes/predict.py's Service Literal) — it takes a slug, not services.id, and
// there's no confirmed slug column on `services` yet, so match by name as a best effort.
const SERVICE_SLUGS: Record<string, string> = {
  general: 'general_opd',
  opd: 'general_opd',
  pediatric: 'pediatrics',
  paediatric: 'pediatrics',
  ortho: 'ortho',
  dental: 'dental',
  eye: 'eye',
};

function matchServiceSlug(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [needle, slug] of Object.entries(SERVICE_SLUGS)) {
    if (lower.includes(needle)) return slug;
  }
  return null;
}

function formatWait(seconds: number): string {
  if (seconds <= 0) return 'No wait';
  if (seconds < 60) return '< 1 min';
  return `~${Math.round(seconds / 60)} min`;
}

function ServiceCard({
  service,
  boardRow,
  onPress,
}: {
  service: Service;
  boardRow: BoardService;
  onPress: () => void;
}) {
  const theme = useTheme();
  const localEstimate = estimateWaitSeconds(boardRow.waiting_count, boardRow.avg_service_secs, boardRow.open_counters);
  const [predictedSeconds, setPredictedSeconds] = useState<number | null>(null);

  // Best-effort prediction upgrade — never blocks first paint, which already shows localEstimate.
  useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    const slug = matchServiceSlug(service.name);
    if (!apiUrl || !slug) return;
    let cancelled = false;

    const now = new Date();
    // apps/api's training data uses weekday 0 = Monday; JS Date#getDay() uses 0 = Sunday.
    const weekday = (now.getDay() + 6) % 7;

    fetch(`${apiUrl}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: slug,
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
        // Any failure/timeout/missing URL/unrecognized service name — the local estimate
        // already on screen is enough.
      });

    return () => {
      cancelled = true;
    };
  }, [service.id, service.name, boardRow.waiting_count, boardRow.open_counters]);

  const waitSeconds = predictedSeconds ?? localEstimate;
  const label = predictedSeconds !== null ? 'predicted' : 'estimate';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.hairline, opacity: pressed ? 0.85 : 1 },
      ]}>
      <ThemedText type="headingMd">{service.name}</ThemedText>
      <View style={styles.cardRow}>
        <ThemedText type="bodySm" themeColor="inkSecondary">
          {boardRow.waiting_count} waiting
        </ThemedText>
        <ThemedText type="bodySm" themeColor="inkMuted">
          {formatWait(waitSeconds)} ({label})
        </ThemedText>
      </View>
    </Pressable>
  );
}

export default function Home() {
  const theme = useTheme();
  const router = useRouter();

  const [services, setServices] = useState<Service[]>([]);
  const [boardRows, setBoardRows] = useState<Record<string, BoardServiceRow>>({});
  const [openCounters, setOpenCounters] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Service | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const today = todayDateString();

    async function load() {
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
        if (cancelled) return;

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
        if (!cancelled) setLoadError("Couldn't load services right now — check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Realtime never replays missed events — refetch the full snapshot on first connect and
    // every reconnect (status === 'SUBSCRIBED'), not just once on mount.
    const channel = supabase
      .channel('home-board-services')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'board_services', filter: `day=eq.${today}` },
        (payload: RealtimePostgresChangesPayload<BoardServiceRow>) => {
          setBoardRows((prev) => {
            const next = { ...prev };
            if (payload.eventType === 'DELETE') {
              const oldRow = payload.old as Partial<BoardServiceRow>;
              if (oldRow.service_id) delete next[oldRow.service_id];
            } else {
              const row = payload.new as BoardServiceRow;
              next[row.service_id] = row;
            }
            return next;
          });
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') load();
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleConfirm() {
    if (!selected || submitting) return;
    setSubmitting(true);
    setConfirmError(null);

    const { data, error } = await supabase.rpc('issue_token', { p_service: selected.id });

    if (!error && data) {
      const ticket = data as { id: string };
      const serviceId = selected.id;
      setSubmitting(false);
      setSelected(null);
      router.push({ pathname: '/(app)/token/[id]', params: { id: ticket.id, serviceId } });
      return;
    }

    // Idempotency: a retry after a successful mint returns `already_active` with the existing
    // ticket in error.details (a JSON string) instead of a fresh success — treat it the same
    // as success rather than showing an error.
    if (error && (error.code === 'already_active' || error.message === 'already_active')) {
      try {
        const raw = (error as { details?: string }).details;
        const details = typeof raw === 'string' ? JSON.parse(raw) : null;
        if (details?.id) {
          const serviceId = selected.id;
          setSubmitting(false);
          setSelected(null);
          router.push({ pathname: '/(app)/token/[id]', params: { id: details.id, serviceId } });
          return;
        }
      } catch {
        // Malformed/missing details — fall through to the mapped error toast below.
      }
    }

    setSubmitting(false);
    setConfirmError(mapSupabaseError({ code: error?.code, message: error?.message }));
  }

  function closeSheet() {
    if (submitting) return;
    setSelected(null);
    setConfirmError(null);
  }

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="displayMd" style={styles.title}>
          Queueless
        </ThemedText>
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          Tap a service to take a token.
        </ThemedText>

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : loadError ? (
          <View style={styles.centerFill}>
            <ThemedText type="body" themeColor="inkMuted" style={styles.emptyText}>
              {loadError}
            </ThemedText>
          </View>
        ) : services.length === 0 ? (
          <View style={styles.centerFill}>
            <ThemedText type="body" themeColor="inkMuted" style={styles.emptyText}>
              No services are open right now. Check back soon.
            </ThemedText>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                boardRow={{
                  waiting_count: boardRows[service.id]?.waiting_count ?? EMPTY_BOARD_ROW.waiting_count,
                  avg_service_secs: boardRows[service.id]?.avg_service_secs ?? service.default_service_secs,
                  open_counters: openCounters[service.id] ?? EMPTY_BOARD_ROW.open_counters,
                }}
                onPress={() => setSelected(service)}
              />
            ))}
          </ScrollView>
        )}
      </SafeAreaView>

      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={closeSheet}>
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
          <ThemedView type="surface" style={[styles.sheet, { borderColor: theme.hairline }]}>
            <ThemedText type="headingLg">{selected?.name}</ThemedText>
            <ThemedText type="body" themeColor="inkSecondary" style={styles.sheetSubtitle}>
              You&apos;ll get a token number and your place in the queue.
            </ThemedText>

            {confirmError ? (
              <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
                {confirmError}
              </ThemedText>
            ) : null}

            <Pressable
              onPress={handleConfirm}
              disabled={submitting}
              style={[styles.button, { backgroundColor: theme.primary, opacity: submitting ? 0.6 : 1 }]}>
              {submitting ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <ThemedText type="button" themeColor="onPrimary">
                  Take token
                </ThemedText>
              )}
            </Pressable>

            <Pressable onPress={closeSheet} disabled={submitting} style={styles.cancelButton}>
              <ThemedText type="button" themeColor="inkSecondary">
                Cancel
              </ThemedText>
            </Pressable>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  title: { marginTop: Spacing.sm },
  subtitle: { marginTop: Spacing.xxs, marginBottom: Spacing.md },
  list: { paddingBottom: Spacing.xl, gap: Spacing.sm },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', paddingHorizontal: Spacing.lg },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.md,
    minHeight: 44,
    gap: Spacing.xxs,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.xxs },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Rounded.xl,
    borderTopRightRadius: Rounded.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  sheetSubtitle: { marginTop: Spacing.xxs, marginBottom: Spacing.md },
  error: { marginBottom: Spacing.xs },
  button: {
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  cancelButton: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});
