import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PriorityInfoCard } from '@/components/PriorityInfoCard';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

// `@queueless/db` only exports the RPC error map, not row types — the real Database types
// haven't landed yet (see apps/web/types/database.types.ts's own header comment). Typed here
// straight from supabase/README.md's `my_queue_status` signature instead of importing another
// app's hand-written placeholder.
type TokenStatus = 'waiting' | 'called' | 'serving' | 'done' | 'no_show' | 'cancelled' | 'skipped';

type QueueStatus = {
  code: string;
  status: TokenStatus;
  service_name: string;
  position: number | null;
  ahead: number | null;
  eta_seconds: number | null;
  counter_name: string | null;
  called_at: string | null;
  no_show_deadline: string | null;
  recall_count: number | null;
};

const PROGRESS_STEPS: { key: TokenStatus; label: string }[] = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'called', label: 'Called' },
  { key: 'serving', label: 'Serving' },
  { key: 'done', label: 'Done' },
];

const STATUS_LABELS: Record<TokenStatus, string> = {
  waiting: 'Waiting',
  called: "You've been called",
  serving: 'Now serving you',
  done: 'Visit complete',
  no_show: 'Marked as no-show',
  cancelled: 'Ticket cancelled',
  skipped: 'Skipped — you will be recalled',
};

const TERMINAL_STATUSES = new Set<TokenStatus>(['no_show', 'cancelled', 'skipped']);

/** Round up to whole minutes; anything under a minute reads clearer as "less than a minute". */
export function formatEta(etaSeconds: number | null): string | null {
  if (etaSeconds == null) return null;
  if (etaSeconds < 60) return 'Less than a minute';
  return `About ${Math.ceil(etaSeconds / 60)} min`;
}

/** Manual/CI sanity check — not run automatically at import time. Call `demo()` yourself to check. */
export function demo() {
  console.assert(formatEta(null) === null, 'null eta stays null');
  console.assert(formatEta(30) === 'Less than a minute', 'sub-minute eta reads as "less than a minute"');
  console.assert(formatEta(60) === 'About 1 min', 'exact minute');
  console.assert(formatEta(61) === 'About 2 min', 'rounds up, never down');
}

export default function TokenScreen() {
  const params = useLocalSearchParams<{ id?: string | string[]; serviceId?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const serviceId = Array.isArray(params.serviceId) ? params.serviceId[0] : params.serviceId;
  const router = useRouter();
  const theme = useTheme();

  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase.rpc('my_queue_status', { p_token: id }).single();
    if (error) {
      setErrorMsg(mapSupabaseError(error));
    } else {
      setStatus(data as QueueStatus);
      setErrorMsg(null);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setErrorMsg("We couldn't find that ticket.");
      return;
    }
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [id, refetch]);

  // Realtime: refetch on any change to our own tokens row, and — when we know which service
  // this ticket belongs to — on any change to that service's board too, since other people's
  // tickets advancing ahead of us changes our position/eta without touching our own row.
  // `board_services.service_id` is a best-effort assumed column name (see DECISIONS.md).
  useEffect(() => {
    if (!id) return;

    const tokenChannel = supabase
      .channel(`token:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens', filter: `id=eq.${id}` }, () => {
        refetch();
      })
      .subscribe((subStatus) => {
        if (subStatus === 'SUBSCRIBED') refetch();
      });

    const boardChannel = serviceId
      ? supabase
          .channel(`board:${serviceId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'board_services', filter: `service_id=eq.${serviceId}` },
            () => {
              refetch();
            },
          )
          .subscribe((subStatus) => {
            if (subStatus === 'SUBSCRIBED') refetch();
          })
      : null;

    return () => {
      supabase.removeChannel(tokenChannel);
      if (boardChannel) supabase.removeChannel(boardChannel);
    };
  }, [id, serviceId, refetch]);

  // Realtime never replays missed events — also refetch whenever the app comes back to the
  // foreground in case something changed while backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  async function handleCancel() {
    if (!id) return;
    setCancelling(true);
    setCancelError(null);
    const { error } = await supabase.rpc('cancel_token', { p_token: id });
    if (error) {
      setCancelling(false);
      setCancelError(mapSupabaseError(error));
      return;
    }
    router.back();
  }

  function confirmCancel() {
    Alert.alert('Cancel this ticket?', "You'll lose your place in the queue.", [
      { text: 'Keep ticket', style: 'cancel' },
      { text: 'Cancel ticket', style: 'destructive', onPress: handleCancel },
    ]);
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.center} edges={['bottom', 'left', 'right']}>
          <ActivityIndicator size="large" color={theme.primary} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!status) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.center} edges={['bottom', 'left', 'right']}>
          <ThemedText type="headingMd" style={styles.centerText}>
            {errorMsg ?? "We couldn't find that ticket."}
          </ThemedText>
          <Pressable
            onPress={() => router.back()}
            style={[styles.secondaryButton, { borderColor: theme.hairlineStrong }]}>
            <ThemedText type="button">Go back</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const currentStepIndex = PROGRESS_STEPS.findIndex((step) => step.key === status.status);
  const isTerminal = TERMINAL_STATUSES.has(status.status);
  const eta = formatEta(status.eta_seconds);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="tokenNumber" style={styles.tokenCode}>
            {status.code}
          </ThemedText>
          <ThemedText type="body" themeColor="inkSecondary" style={styles.centerText}>
            {status.service_name}
          </ThemedText>

          <ThemedText type="headingMd" style={styles.centerText}>
            {STATUS_LABELS[status.status]}
          </ThemedText>

          {!isTerminal ? (
            <View style={styles.progressBlock}>
              <View style={styles.progressTrack}>
                {PROGRESS_STEPS.map((step, i) => (
                  <View
                    key={step.key}
                    style={[
                      styles.progressSegment,
                      { backgroundColor: i <= currentStepIndex ? theme.primary : theme.hairlineStrong },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.progressLabels}>
                {PROGRESS_STEPS.map((step, i) => (
                  <ThemedText
                    key={step.key}
                    type="caption"
                    themeColor={i <= currentStepIndex ? 'primary' : 'inkMuted'}
                    style={styles.progressLabelText}>
                    {step.label}
                  </ThemedText>
                ))}
              </View>
            </View>
          ) : null}

          {status.counter_name ? (
            <View style={[styles.counterBanner, { backgroundColor: theme.primarySoft }]}>
              <ThemedText type="headingLg" themeColor="primary" style={styles.centerText}>
                Called to {status.counter_name}
              </ThemedText>
            </View>
          ) : null}

          {!isTerminal && status.status === 'waiting' && status.position != null ? (
            <ThemedText type="bodyLg" style={styles.centerText}>
              Position {status.position}
              {status.ahead != null ? ` · ${status.ahead} ahead of you` : ''}
            </ThemedText>
          ) : null}

          {!isTerminal && eta ? (
            <ThemedText type="bodyLg" themeColor="inkSecondary" style={styles.centerText}>
              {eta}
            </ThemedText>
          ) : null}

          <PriorityInfoCard />

          {cancelError ? (
            <ThemedText type="bodySm" themeColor="danger" style={styles.centerText}>
              {cancelError}
            </ThemedText>
          ) : null}

          {status.status === 'waiting' ? (
            <Pressable
              onPress={confirmCancel}
              disabled={cancelling}
              style={[styles.cancelButton, { backgroundColor: theme.dangerSoft, opacity: cancelling ? 0.6 : 1 }]}>
              {cancelling ? (
                <ActivityIndicator color={theme.danger} />
              ) : (
                <ThemedText type="button" themeColor="danger">
                  Cancel ticket
                </ThemedText>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.lg, gap: Spacing.md },
  centerText: { textAlign: 'center' },
  content: { padding: Spacing.lg, alignItems: 'center', gap: Spacing.lg },
  tokenCode: { textAlign: 'center', marginTop: Spacing.md },
  progressBlock: { alignSelf: 'stretch', gap: Spacing.xxs },
  progressTrack: { flexDirection: 'row', gap: Spacing.xxs, height: 8 },
  progressSegment: { flex: 1, borderRadius: Rounded.pill },
  progressLabels: { flexDirection: 'row' },
  progressLabelText: { flex: 1, textAlign: 'center' },
  counterBanner: { alignSelf: 'stretch', borderRadius: Rounded.lg, padding: Spacing.md },
  cancelButton: {
    alignSelf: 'stretch',
    minHeight: 48,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
