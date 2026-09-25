import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QueueTracker } from '@/components/motion/QueueTracker';
import { useEtaAtJoin, useNowServing } from '@/components/motion/use-queue-extras';
import { PriorityInfoCard } from '@/components/PriorityInfoCard';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatFee } from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
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

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token ?? '';
    const payUrl = `https://lpu.lol/pay/${id}#access_token=${accessToken}`;

    const result = await WebBrowser.openAuthSessionAsync(payUrl, `queueless://paid/${id}`);
    setPaying(false);

    if (result.type === 'success') {
      markTokenPaid(id);
      setHoldSecondsLeft(HOLD_SECONDS);
      refetch();
    } else if (result.type !== 'cancel' && result.type !== 'dismiss') {
      setPayError("Couldn't open the payment page — check your connection and try again.");
    }
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
        <SafeAreaView style={styles.center} edges={['bottom', 'left', 'right']}>
          <ActivityIndicator size="large" color={theme.primary} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!status) {
    return (
      <ThemedView type="canvasSoft" style={styles.container}>
        <SafeAreaView style={styles.center} edges={['bottom', 'left', 'right']}>
          <View
            style={[styles.errorCard, { backgroundColor: theme.surface, borderColor: theme.hairline }, CardShadow]}>
            <ThemedText type="headingMd" style={styles.centerText}>
              {errorMsg ?? "We couldn't find that ticket."}
            </ThemedText>
            <Pressable
              onPress={() => router.back()}
              style={[styles.secondaryButton, { borderColor: theme.primaryOutline }]}>
              <ThemedText type="button">Go back</ThemedText>
            </Pressable>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isTerminal = TERMINAL_STATUSES.has(status.status);

  return (
    <ThemedView type="canvasSoft" style={styles.container}>
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[styles.tokenCard, { backgroundColor: theme.surface, borderColor: theme.hairline }, CardShadow]}>
            <ThemedText type="tokenNumber" style={styles.tokenCode}>
              {status.code}
            </ThemedText>
            <ThemedText type="body" themeColor="inkSecondary" style={styles.centerText}>
              {status.service_name}
            </ThemedText>
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
            <View style={[styles.holdBanner, { backgroundColor: theme.successSoft, borderColor: theme.success }]}>
              <ThemedText type="headingSm" themeColor="success" style={styles.centerText}>
                Payment received
              </ThemedText>
              <ThemedText type="bodySm" themeColor="inkSecondary" style={styles.centerText}>
                Your slot is held for {Math.floor(holdSecondsLeft / 60)}:{String(holdSecondsLeft % 60).padStart(2, '0')}
              </ThemedText>
            </View>
          ) : !isTerminal && feeInr != null && feeInr > 0 ? (
            <Pressable
              onPress={handleBookAndPay}
              disabled={paying}
              style={[styles.payButton, { backgroundColor: theme.primary, opacity: paying ? 0.6 : 1 }]}>
              {paying ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <ThemedText type="button" themeColor="onPrimary">
                  Book &amp; pay {formatFee(feeInr)}
                </ThemedText>
              )}
            </Pressable>
          ) : null}

          {payError ? (
            <ThemedText type="bodySm" themeColor="danger" style={styles.centerText}>
              {payError}
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
  tokenCard: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Rounded.xl,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xs,
  },
  tokenCode: { textAlign: 'center' },
  holdBanner: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: Rounded.xl,
    padding: Spacing.md,
    gap: Spacing.xxs,
  },
  payButton: {
    alignSelf: 'stretch',
    minHeight: 48,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  errorCard: {
    alignItems: 'center',
    gap: Spacing.md,
    borderWidth: 1,
    borderRadius: Rounded.xl,
    padding: Spacing.xl,
  },
});
