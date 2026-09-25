import * as Haptics from 'expo-haptics';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignOutButton } from '@/components/sign-out-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { todayDateString } from '@/lib/service-day';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Confirmed against supabase/migrations/0003_services_counters.sql and 0004_tokens.sql. There is
// no `claim_counter` RPC and no staff-writable path to `counters.staff_id` at all (that column
// is admin-only under RLS) — the DB design deliberately lets any staff member in an org drive
// any of its desks (docs/DECISIONS.md, verified against the DB session's own honesty note in
// its prompt). "Pick my counter" below is a client-side view selection only, not a claim.
type CounterRow = { id: string; name: string; state: 'open' | 'paused' | 'closed' };
type TokenRow = {
  id: string;
  code: string;
  number: number;
  lane: string;
  lane_rank: number;
  status: string;
  patient_id: string | null;
  walk_in_label: string | null;
  counter_id: string | null;
  recall_count: number;
  service_id: string;
};

const COUNTER_STATES: CounterRow['state'][] = ['open', 'paused', 'closed'];
const SELECTED_COUNTER_KEY = 'queueless-selected-counter';

function laneLabel(lane: string): string {
  if (lane === 'senior') return 'Senior';
  if (lane === 'pregnant') return 'Pregnant';
  if (lane === 'emergency') return 'Emergency';
  if (lane === 'appointment') return 'Appointment';
  return 'Walk-in';
}

function holderLabel(token: Pick<TokenRow, 'patient_id' | 'walk_in_label'>): string {
  // Never show a patient_id — that's an internal id, not a display value; a signed-in
  // patient's own name isn't readable here without a join this screen doesn't need.
  return token.walk_in_label ?? (token.patient_id ? 'Patient' : 'Unknown');
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: { code?: string; message?: string } | null }> {
  const { data, error } = await supabase.rpc(name, args);
  return { data: data as T | null, error };
}

export default function Counter() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [selectedCounterId, setSelectedCounterId] = useState<string | null>(null);
  const [current, setCurrent] = useState<TokenRow | null>(null);
  const [queue, setQueue] = useState<TokenRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [lookupCode, setLookupCode] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<TokenRow | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const selectedCounter = counters.find((c) => c.id === selectedCounterId) ?? null;

  // Counters list — org-scoped, read-only (counters is anon/authenticated select per
  // 0030_rls_public_tables.sql). Restores the last-picked counter for this device.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    supabase
      .from('counters')
      .select('id, name, state')
      .eq('org_id', orgId)
      .order('name')
      .then(({ data }) => {
        if (cancelled || !data) return;
        setCounters(data as CounterRow[]);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(SELECTED_COUNTER_KEY);
        } catch {
          // Non-fatal — just starts unselected.
        }
        if (saved && data.some((c) => c.id === saved)) setSelectedCounterId(saved);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  function selectCounter(id: string) {
    setSelectedCounterId(id);
    try {
      localStorage.setItem(SELECTED_COUNTER_KEY, id);
    } catch {
      // Non-fatal.
    }
  }

  // Which services this counter serves, and its current/queue state, refreshed on selection and
  // on every Realtime event for this org's tokens (never replays missed events, so also on
  // reconnect) — mirrors the pattern already used on Home/token detail.
  const refetch = useCallback(async () => {
    if (!selectedCounterId || !orgId) return;
    const today = todayDateString();

    const { data: csRows } = await supabase
      .from('counter_services')
      .select('service_id')
      .eq('counter_id', selectedCounterId);
    const serviceIds = (csRows ?? []).map((r) => r.service_id as string);

    const { data: currentRows } = await supabase
      .from('tokens')
      .select('id, code, number, lane, lane_rank, status, patient_id, walk_in_label, counter_id, recall_count, service_id')
      .eq('counter_id', selectedCounterId)
      .in('status', ['called', 'serving'])
      .limit(1);
    setCurrent(((currentRows ?? [])[0] as TokenRow | undefined) ?? null);

    if (serviceIds.length > 0) {
      const { data: queueRows } = await supabase
        .from('tokens')
        .select('id, code, number, lane, lane_rank, status, patient_id, walk_in_label, counter_id, recall_count, service_id')
        .in('service_id', serviceIds)
        .eq('service_day', today)
        .eq('status', 'waiting')
        .order('lane_rank', { ascending: true })
        .order('priority_at', { ascending: true })
        .order('number', { ascending: true })
        .limit(30);
      setQueue((queueRows ?? []) as TokenRow[]);
    } else {
      setQueue([]);
    }
  }, [selectedCounterId, orgId]);
  useLiveRefresh(refetch);

  // One effect drives both the initial/counter-switch load and the realtime subscription,
  // mirroring Home's pattern: the subscribe callback's SUBSCRIBED case is the trigger, not a
  // separate bare effect (that's a real "calling setState in a callback when external state
  // changes," not a synchronous effect-body setState). `refetch` changing identity (org or
  // selected counter changes) tears down and resubscribes the channel, whose SUBSCRIBED
  // callback fires again and refetches for the new selection — no extra effect needed.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`counter-tokens:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens', filter: `org_id=eq.${orgId}` }, () => {
        refetch();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refetch();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, refetch]);

  async function withHaptics<T>(action: () => Promise<{ data: T | null; error: { code?: string; message?: string } | null }>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const { error } = await action();
    setBusy(false);
    if (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setActionError(mapSupabaseError(error));
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    refetch();
  }

  async function handleCallNext() {
    if (!selectedCounterId) return;
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const { data, error } = await supabase.rpc('call_next', { p_counter: selectedCounterId });
    setBusy(false);
    if (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setActionError(mapSupabaseError(error));
      return;
    }
    // `call_next` returns `setof tokens` — supabase-js gives an array; empty means the queue
    // for this counter's services is empty right now, not an error.
    const rows = (data as TokenRow[] | null) ?? [];
    if (rows.length === 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setActionError('Queue is empty for this desk right now.');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    refetch();
  }

  function handleCounterState(state: CounterRow['state']) {
    if (!selectedCounterId) return;
    withHaptics(() => rpc('set_counter_state', { p_counter: selectedCounterId, p_state: state }));
  }

  async function handleLookup() {
    const code = lookupCode.trim().toUpperCase();
    if (!code || lookupBusy) return;
    setLookupBusy(true);
    setLookupError(null);
    setLookupResult(null);
    const today = todayDateString();
    const { data, error } = await supabase
      .from('tokens')
      .select('id, code, number, lane, lane_rank, status, patient_id, walk_in_label, counter_id, recall_count, service_id')
      .eq('code', code)
      .eq('org_id', orgId ?? '')
      .eq('service_day', today)
      .maybeSingle();
    setLookupBusy(false);
    if (error || !data) {
      setLookupError("Couldn't find a ticket with that code today.");
      return;
    }
    setLookupResult(data as TokenRow);
  }

  async function handleVerify(status: 'senior' | 'pregnant') {
    if (!lookupResult || lookupBusy) return;
    setLookupBusy(true);
    setLookupError(null);
    const { error } = await supabase.rpc('verify_priority', { p_token: lookupResult.id, p_status: status });
    setLookupBusy(false);
    if (error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setLookupError(mapSupabaseError(error));
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setLookupResult(null);
    setLookupCode('');
    refetch();
  }

  if (roleLoading) {
    return (
      <ThemedView type="canvas" style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="displayMd" style={styles.title}>
            Counter
          </ThemedText>
          <View style={styles.toolbar}>
            <Pressable onPress={() => router.push('/cash-desk' as Href)} accessibilityRole="link" hitSlop={8} style={styles.toolbarLink}>
              <ThemedText type="button" themeColor="primaryText">
                Cash desk ›
              </ThemedText>
            </Pressable>
            <SignOutButton />
          </View>

          {counters.length === 0 ? (
            <ThemedText type="body" themeColor="inkMuted">
              No counters set up for this org yet.
            </ThemedText>
          ) : (
            <View style={styles.pickerRow}>
              {counters.map((c) => {
                const selected = c.id === selectedCounterId;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => selectCounter(c.id)}
                    style={[
                      styles.pickerChip,
                      {
                        backgroundColor: selected ? theme.primary : theme.surface,
                        borderColor: selected ? theme.primary : theme.hairline,
                      },
                    ]}>
                    <ThemedText type="button" themeColor={selected ? 'onPrimary' : 'ink'}>
                      {c.name}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}

          {selectedCounter ? (
            <>
              <View style={styles.segmentedRow}>
                {COUNTER_STATES.map((state) => {
                  const selected = selectedCounter.state === state;
                  return (
                    <Pressable
                      key={state}
                      onPress={() => handleCounterState(state)}
                      disabled={busy}
                      style={[
                        styles.segment,
                        {
                          backgroundColor: selected ? theme.dark : 'transparent',
                          borderColor: selected ? theme.dark : theme.hairline,
                          opacity: busy ? 0.6 : 1,
                        },
                      ]}>
                      <ThemedText type="button" themeColor={selected ? 'onPrimary' : 'inkSecondary'} style={styles.capitalize}>
                        {state}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              {actionError ? (
                <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
                  {actionError}
                </ThemedText>
              ) : null}

              <ThemedView type="surface" style={[styles.currentCard, CardShadow, { borderColor: theme.hairline }]}>
                {current ? (
                  <>
                    <View style={styles.currentHeader}>
                      <ThemedText type="tokenNumber" themeColor="primaryDisplay">
                        {current.code}
                      </ThemedText>
                      <View style={[styles.laneBadge, { backgroundColor: theme.primarySoft, borderColor: theme.primaryOutline }]}>
                        <ThemedText type="caption" themeColor="primaryText">
                          {laneLabel(current.lane)}
                        </ThemedText>
                      </View>
                    </View>
                    <ThemedText type="body" themeColor="inkSecondary">
                      {holderLabel(current)} · {current.status}
                      {current.recall_count > 0 ? ` · recalled ${current.recall_count}x` : ''}
                    </ThemedText>

                    <View style={styles.actionRow}>
                      {current.status === 'called' ? (
                        <>
                          <Pressable
                            onPress={() => withHaptics(() => rpc('start_serving', { p_token: current.id }))}
                            disabled={busy}
                            style={[styles.actionButton, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}>
                            <ThemedText type="button" themeColor="onPrimary">
                              Start serving
                            </ThemedText>
                          </Pressable>
                          <Pressable
                            onPress={() => withHaptics(() => rpc('recall_token', { p_token: current.id }))}
                            disabled={busy || current.recall_count >= 2}
                            style={[styles.actionButtonOutline, { borderColor: theme.hairline, opacity: busy || current.recall_count >= 2 ? 0.5 : 1 }]}>
                            <ThemedText type="button" themeColor="ink">
                              Recall
                            </ThemedText>
                          </Pressable>
                          <Pressable
                            onPress={() => withHaptics(() => rpc('skip_token', { p_token: current.id }))}
                            disabled={busy}
                            style={[styles.actionButtonOutline, { borderColor: theme.danger, opacity: busy ? 0.6 : 1 }]}>
                            <ThemedText type="button" themeColor="danger">
                              Skip / no-show
                            </ThemedText>
                          </Pressable>
                        </>
                      ) : (
                        <Pressable
                          onPress={() => withHaptics(() => rpc('complete_token', { p_token: current.id }))}
                          disabled={busy}
                          style={[styles.actionButton, { backgroundColor: theme.success, opacity: busy ? 0.6 : 1 }]}>
                          <ThemedText type="button" themeColor="onPrimary">
                            Complete
                          </ThemedText>
                        </Pressable>
                      )}
                    </View>
                  </>
                ) : (
                  <>
                    <ThemedText type="body" themeColor="inkMuted" style={styles.emptyDeskText}>
                      This desk isn&apos;t serving anyone right now.
                    </ThemedText>
                    <Pressable
                      onPress={handleCallNext}
                      disabled={busy || selectedCounter.state !== 'open'}
                      style={[
                        styles.callNextButton,
                        { backgroundColor: theme.primary, opacity: busy || selectedCounter.state !== 'open' ? 0.5 : 1 },
                      ]}>
                      {busy ? (
                        <ActivityIndicator color={theme.onPrimary} />
                      ) : (
                        <ThemedText type="headingSm" themeColor="onPrimary">
                          Call next
                        </ThemedText>
                      )}
                    </Pressable>
                    {selectedCounter.state !== 'open' ? (
                      <ThemedText type="caption" themeColor="inkMuted" style={styles.emptyDeskText}>
                        Open this desk to call the next patient.
                      </ThemedText>
                    ) : null}
                  </>
                )}
              </ThemedView>

              <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
                Waiting ({queue.length})
              </ThemedText>
              <ThemedView type="surface" style={[styles.queueCard, CardShadow, { borderColor: theme.hairline }]}>
                {queue.length === 0 ? (
                  <ThemedText type="bodySm" themeColor="inkMuted" style={styles.queueEmpty}>
                    Nobody waiting for this desk&apos;s services.
                  </ThemedText>
                ) : (
                  queue.map((t, i) => (
                    <View key={t.id} style={[styles.queueRow, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
                      <ThemedText type="bodyLg">{t.code}</ThemedText>
                      <ThemedText type="bodySm" themeColor="inkMuted">
                        {laneLabel(t.lane)} · {holderLabel(t)}
                      </ThemedText>
                    </View>
                  ))
                )}
              </ThemedView>

              <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
                Verify priority
              </ThemedText>
              <ThemedView type="surface" style={[styles.queueCard, CardShadow, { borderColor: theme.hairline }]}>
                <View style={styles.lookupRow}>
                  <TextInput
                    value={lookupCode}
                    onChangeText={setLookupCode}
                    placeholder="Ticket code, e.g. G-042"
                    placeholderTextColor={theme.inkMuted}
                    autoCapitalize="characters"
                    style={[styles.lookupInput, { color: theme.ink, borderColor: theme.hairline }]}
                  />
                  <Pressable
                    onPress={handleLookup}
                    disabled={lookupBusy || !lookupCode.trim()}
                    style={[styles.lookupButton, { backgroundColor: theme.dark, opacity: lookupBusy ? 0.6 : 1 }]}>
                    <ThemedText type="button" themeColor="onPrimary">
                      Find
                    </ThemedText>
                  </Pressable>
                </View>

                {lookupError ? (
                  <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
                    {lookupError}
                  </ThemedText>
                ) : null}

                {lookupResult ? (
                  <View style={styles.lookupResult}>
                    <ThemedText type="headingSm">{lookupResult.code}</ThemedText>
                    <ThemedText type="bodySm" themeColor="inkSecondary">
                      {holderLabel(lookupResult)} · currently {laneLabel(lookupResult.lane)}
                    </ThemedText>
                    <View style={styles.actionRow}>
                      <Pressable
                        onPress={() => handleVerify('senior')}
                        disabled={lookupBusy}
                        style={[styles.actionButtonOutline, { borderColor: theme.primaryOutline, opacity: lookupBusy ? 0.6 : 1 }]}>
                        <ThemedText type="button" themeColor="primaryText">
                          Mark senior
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => handleVerify('pregnant')}
                        disabled={lookupBusy}
                        style={[styles.actionButtonOutline, { borderColor: theme.primaryOutline, opacity: lookupBusy ? 0.6 : 1 }]}>
                        <ThemedText type="button" themeColor="primaryText">
                          Mark pregnant
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </ThemedView>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: -Spacing.sm },
  toolbarLink: { minHeight: 44, justifyContent: 'center' },
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingBottom: Spacing.xxl, gap: Spacing.sm },
  title: { marginTop: Spacing.sm },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.xs },
  pickerChip: {
    borderWidth: 1,
    borderRadius: Rounded.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  segmentedRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  segment: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capitalize: { textTransform: 'capitalize' },
  error: { marginTop: Spacing.xs },
  currentCard: {
    borderWidth: 1,
    borderRadius: Rounded.xl,
    padding: Spacing.lg,
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  currentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  laneBadge: { borderWidth: 1, borderRadius: Rounded.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.xs },
  actionButton: {
    flexGrow: 1,
    minHeight: 48,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  actionButtonOutline: {
    flexGrow: 1,
    minHeight: 48,
    borderRadius: Rounded.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  emptyDeskText: { textAlign: 'center' },
  callNextButton: {
    minHeight: 56,
    borderRadius: Rounded.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  sectionLabel: { marginTop: Spacing.md, marginBottom: Spacing.xs },
  queueCard: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.sm },
  queueEmpty: { padding: Spacing.sm, textAlign: 'center' },
  queueRow: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xs, gap: 2 },
  lookupRow: { flexDirection: 'row', gap: Spacing.xs },
  lookupInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
  },
  lookupButton: { minHeight: 44, borderRadius: Rounded.md, paddingHorizontal: Spacing.md, justifyContent: 'center' },
  lookupResult: { marginTop: Spacing.sm, gap: Spacing.xxs },
});
