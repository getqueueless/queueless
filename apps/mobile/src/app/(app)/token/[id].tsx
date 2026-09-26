import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QueueTracker } from '@/components/motion/QueueTracker';
import { useEtaAtJoin, useNowServing } from '@/components/motion/use-queue-extras';
import { PriorityInfoCard } from '@/components/PriorityInfoCard';
import { Button, EmptyState, Skeleton, Tones, UIText, gradient, toneFor } from '@/components/ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatFee } from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
import { openPaymentHandoff } from '@/lib/paid-booking';
import { markTokenPaid } from '@/lib/paid-tokens';
import { supabase } from '@/lib/supabase';
import { useServiceUpdates } from '@/lib/service-updates';
import { useLiveRefresh } from '@/lib/use-live-refresh';

// Client-only reassurance banner, no server backing: there's no "payment_pending"/hold state in
// token_status (checked every migration through 0042), and the payments page's own token/hold
// semantics aren't part of this schema yet -- see docs/DECISIONS.md. Purely cosmetic; it never
// blocks or changes the real queue position underneath it.
const HOLD_SECONDS = 5 * 60;

// `@queueless/db` only exports the RPC error map, not row types — the real Database types
// haven't landed yet (see apps/web/types/database.types.ts's own header comment). Typed here
// straight from supabase/README.md's `my_queue_status` signature instead of importing another
// app's hand-written placeholder.
// `pending_payment` landed in `0050_payments_enum.sql` — included here (see docs/DECISIONS.md's
// 2026-09-25 payments self-review flag) so a token mid-checkout still maps onto QueueTracker's
// Booked stage, even though this screen doesn't drive the payment flow itself.
type TokenStatus = 'pending_payment' | 'waiting' | 'called' | 'serving' | 'done' | 'no_show' | 'cancelled' | 'skipped';

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
  const dark = useColorScheme() === 'dark';

  const [status, setStatus] = useState<QueueStatus | null>(null);
  // Derived straight from the route param at first render, not via an effect + setState, so
  // there's no missing-id case to synchronize after mount.
  const [loading, setLoading] = useState(!!id);
  const [errorMsg, setErrorMsg] = useState<string | null>(id ? null : "We couldn't find that ticket.");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [feeInr, setFeeInr] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    supabase
      .from('tokens')
      .select('doctor_id, doctors(fee_inr)')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        // Same many-to-one embed quirk as Home's counter_services join — PostgREST returns a
        // single object here, but supabase-js can't infer that without generated types.
        const embed = (data as { doctors: { fee_inr: number } | { fee_inr: number }[] | null }).doctors;
        const doctor = Array.isArray(embed) ? embed[0] : embed;
        setFeeInr(doctor?.fee_inr ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (holdSecondsLeft <= 0) return;
    const timer = setInterval(() => setHoldSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [holdSecondsLeft]);

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

  // Belt-and-suspenders on top of the realtime channels below: self-hosted Realtime can miss
  // events on reconnect, so re-pull the real status on every screen focus and every 10s while
  // this screen stays open. 10s (not the shared 15s default) since a queue position is the one
  // thing a patient stares at waiting for it to move.
  useLiveRefresh(refetch, 10_000);

  async function handleBookAndPay() {
    if (!id || paying) return;
    setPaying(true);
    setPayError(null);

    const result = await openPaymentHandoff(id);
    setPaying(false);

    if (result.paid) {
      markTokenPaid(id);
      setHoldSecondsLeft(HOLD_SECONDS);
    }
    // Not an error either way -- refetch() reads the real status back from the server, the same
    // ground truth this screen already polls every 10s via useLiveRefresh above.
    refetch();
  }

  useEffect(() => {
    if (!id) return;
    // Standard fetch-on-param-change pattern: re-show the loading state when navigating from
    // one token id to another without unmounting this screen. Not a synchronization bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [id, refetch]);

  // Realtime: refetch on any change to our own ticket, and — when we know which service this
  // ticket belongs to — on any change to that service's queue too, since other people's tickets
  // advancing ahead of us changes our position/eta without touching our own row.
  //
  // Both are the DB broadcast topics from docs/API_CONTRACT.md's "Realtime topics" (migration
  // 0044), not `postgres_changes`: on this self-hosted stack the `supabase_realtime` publication
  // has zero member tables, so a `postgres_changes` listener on `tokens`/`board_services` would
  // silently receive nothing — confirmed in that doc, not a guess. `token:<id>` only fires for
  // this ticket's own writes, which is why `service:<id>` (via the shared `useServiceUpdates`,
  // already used by Home's LiveTokenHero/DepartmentGrid) is also needed for everyone else's.
  useEffect(() => {
    if (!id) return;
    const tokenChannel = supabase
      .channel(`token:${id}`)
      .on('broadcast', { event: 'token_update' }, () => refetch())
      .subscribe((subStatus) => {
        if (subStatus === 'SUBSCRIBED') refetch();
      });
    return () => {
      supabase.removeChannel(tokenChannel);
    };
  }, [id, refetch]);

  useServiceUpdates(serviceId ? [serviceId] : [], refetch);

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

  // QueueTracker's two extra inputs. The now-serving read rides on this screen's own refetches.
  const etaMinutes = status?.eta_seconds == null ? null : Math.ceil(status.eta_seconds / 60);
  const etaAtJoin = useEtaAtJoin(id, etaMinutes);
  const nowServing = useNowServing(id, status);

  if (loading) {
    return (
      <ThemedView type="canvasSoft" style={styles.container}>
        <SafeAreaView style={styles.content} edges={['bottom', 'left', 'right']} accessibilityLabel="Loading your ticket">
          <Skeleton height={132} radius={20} />
          <Skeleton width={144} height={144} radius={72} style={styles.centerSelf} />
          <Skeleton height={56} radius={16} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!status) {
    return (
      <ThemedView type="canvasSoft" style={styles.container}>
        <SafeAreaView style={styles.center} edges={['bottom', 'left', 'right']}>
          <EmptyState
            icon={{ ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' }}
            title={errorMsg ? "Couldn't open this ticket" : 'Ticket not found'}
            text={errorMsg ?? "We couldn't find that ticket."}
            action={{ label: 'Go back', onPress: () => router.back() }}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isTerminal = TERMINAL_STATUSES.has(status.status);
  // The ticket wears its department's tone, the same one as the department's tile on Home.
  const tone = Tones[toneFor(status.service_name)][dark ? 'dark' : 'light'];

  return (
    <ThemedView type="canvasSoft" style={styles.container}>
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[styles.tokenCard, gradient(tone.from, tone.to), CardShadow]}
            accessible
            accessibilityLabel={`Token ${status.code}, ${status.service_name}`}>
            <ThemedText type="tokenNumber" style={styles.centerText}>
              {status.code}
            </ThemedText>
            <UIText variant="bodyStrong" style={styles.centerText}>
              {status.service_name}
            </UIText>
          </View>

          <QueueTracker
            status={status.status}
            ahead={status.ahead}
            etaMinutes={etaMinutes}
            etaAtJoin={etaAtJoin}
            counterCode={status.counter_name}
            nowServingNumber={nowServing}
            serviceName={status.service_name}
          />

          {holdSecondsLeft > 0 ? (
            <View style={[styles.holdBanner, { backgroundColor: theme.successSoft }]}>
              <UIText variant="bodyStrong" color="success" style={styles.centerText}>
                Payment received
              </UIText>
              <UIText variant="secondary" style={styles.centerText}>
                Your slot is held for {Math.floor(holdSecondsLeft / 60)}:{String(holdSecondsLeft % 60).padStart(2, '0')}
              </UIText>
            </View>
          ) : !isTerminal && feeInr != null && feeInr > 0 ? (
            <Button label={`Book & pay ${formatFee(feeInr)}`} onPress={handleBookAndPay} loading={paying} block />
          ) : null}

          {payError ? (
            <UIText variant="secondary" color="danger" style={styles.centerText}>
              {payError}
            </UIText>
          ) : null}

          <PriorityInfoCard />

          {cancelError ? (
            <UIText variant="secondary" color="danger" style={styles.centerText}>
              {cancelError}
            </UIText>
          ) : null}

          {status.status === 'waiting' ? (
            <Button label="Cancel ticket" variant="danger" size="md" onPress={confirmCancel} loading={cancelling} style={styles.centerSelf} />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  centerText: { textAlign: 'center' },
  centerSelf: { alignSelf: 'center' },
  content: { padding: 20, gap: 20 },
  tokenCard: {
    alignItems: 'center',
    borderRadius: 20,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xs,
  },
  holdBanner: { borderRadius: 16, padding: Spacing.md, gap: Spacing.xxs },
});
