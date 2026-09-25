import * as Haptics from 'expo-haptics';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedHeading } from '@/components/AnimatedHeading';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button, Card, EmptyState, MIN_TAP, Radius, SectionHeader, StatusChip, Type, UIText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { todayDateString } from '@/lib/service-day';
import { supabase } from '@/lib/supabase';
import { useServiceUpdates } from '@/lib/service-updates';
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
  const [servedServiceIds, setServedServiceIds] = useState<string[]>([]);
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
    if (!orgId) return;
    // Desk states change through set_counter_state (here or on another device), so the list is
    // re-read on every refetch; otherwise "Call next" stays disabled after opening the desk.
    const { data: counterRows } = await supabase.from('counters').select('id, name, state').eq('org_id', orgId).order('name');
    if (counterRows) setCounters(counterRows as CounterRow[]);
    if (!selectedCounterId) return;
    const today = todayDateString();

    const { data: csRows } = await supabase
      .from('counter_services')
      .select('service_id')
      .eq('counter_id', selectedCounterId);
    const serviceIds = (csRows ?? []).map((r) => r.service_id as string);
    setServedServiceIds(serviceIds);

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

  useServiceUpdates(servedServiceIds, refetch);

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

  const deskOpen = selectedCounter?.state === 'open';

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <AnimatedHeading text="Counter" />
            <ThemeToggle />
          </View>
          <View style={styles.toolbar}>
            <Pressable onPress={() => router.push('/cash-desk' as Href)} accessibilityRole="link" hitSlop={8} style={styles.toolbarLink}>
              <ThemedText type="button" themeColor="primaryText">
                Cash desk ›
              </ThemedText>
            </Pressable>
            <SignOutButton />
          </View>

          {counters.length === 0 ? (
            <UIText color="inkSecondary">No counters set up for this org yet.</UIText>
          ) : (
            <View style={styles.pickerRow}>
              {counters.map((c) => {
                const selected = c.id === selectedCounterId;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => selectCounter(c.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[
                      styles.pickerChip,
                      {
                        backgroundColor: selected ? theme.primary : theme.surface,
                        borderColor: selected ? theme.primary : theme.hairline,
                      },
                    ]}>
                    <UIText variant="bodyStrong" style={{ color: selected ? theme.onPrimary : theme.ink }} numberOfLines={1}>
                      {c.name}
                    </UIText>
                  </Pressable>
                );
              })}
            </View>
          )}

          {counters.length > 0 && !selectedCounter ? <UIText color="inkSecondary">Pick your desk to start calling.</UIText> : null}

          {selectedCounter ? (
            <>
              <View style={[styles.segmentedRow, { backgroundColor: theme.surfaceSunken }]} accessibilityRole="radiogroup">
                {COUNTER_STATES.map((state) => {
                  const selected = selectedCounter.state === state;
                  return (
                    <Pressable
                      key={state}
                      onPress={() => handleCounterState(state)}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: busy }}
                      style={[
                        styles.segment,
                        { backgroundColor: selected ? theme.primary : 'transparent', opacity: busy ? 0.6 : 1 },
                      ]}>
                      <UIText
                        variant={selected ? 'bodyStrong' : 'body'}
                        style={[styles.capitalize, { color: selected ? theme.onPrimary : theme.inkSecondary }]}>
                        {state}
                      </UIText>
                    </Pressable>
                  );
                })}
              </View>

              <Card style={styles.currentCard}>
                {current ? (
                  <>
                    <View style={styles.currentMeta}>
                      <StatusChip
                        status={current.status === 'serving' ? 'available' : 'pending'}
                        label={current.status === 'serving' ? 'Serving' : current.status === 'called' ? 'Called' : current.status}
                      />
                      <LaneChip lane={current.lane} />
                    </View>
                    <UIText style={[styles.tokenCode, { color: theme.primaryDisplay }]} numberOfLines={1} adjustsFontSizeToFit>
                      {current.code}
                    </UIText>
                    <UIText color="inkSecondary">
                      {holderLabel(current)}
                      {current.recall_count > 0 ? ` · recalled ${current.recall_count}x` : ''}
                    </UIText>
                  </>
                ) : (
                  <View style={styles.idle}>
                    <UIText variant="title3" style={styles.centerText}>
                      Nobody at the desk
                    </UIText>
                    <UIText color="inkSecondary" style={styles.centerText}>
                      {deskOpen ? 'Call the next patient when you are ready.' : 'Open this desk to call the next patient.'}
                    </UIText>
                  </View>
                )}
              </Card>

              <SectionHeader title={`Waiting (${queue.length})`} />
              {queue.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={{ ios: 'person.2', android: 'group', web: 'group' }}
                    title="Queue is clear"
                    text="Nobody waiting for this desk's services."
                  />
                </Card>
              ) : (
                <Card style={styles.listCard}>
                  {queue.map((t, i) => (
                    <View key={t.id} style={[styles.queueRow, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
                      <View style={styles.queueText}>
                        <UIText variant="title3">{t.code}</UIText>
                        <UIText variant="secondary" numberOfLines={1}>
                          {holderLabel(t)}
                        </UIText>
                      </View>
                      <LaneChip lane={t.lane} />
                    </View>
                  ))}
                </Card>
              )}

              <SectionHeader title="Verify priority" />
              <Card>
                <View style={styles.lookupRow}>
                  <TextInput
                    value={lookupCode}
                    onChangeText={setLookupCode}
                    placeholder="Ticket code, e.g. G-042"
                    placeholderTextColor={theme.inkMuted}
                    autoCapitalize="characters"
                    accessibilityLabel="Ticket code"
                    style={[styles.lookupInput, { color: theme.ink, borderColor: theme.hairline, backgroundColor: theme.canvas }]}
                  />
                  <Button label="Find" size="md" onPress={handleLookup} loading={lookupBusy} disabled={!lookupCode.trim()} />
                </View>

                {lookupError ? (
                  <UIText variant="secondary" color="danger">
                    {lookupError}
                  </UIText>
                ) : null}

                {lookupResult ? (
                  <View style={styles.lookupResult}>
                    <View style={styles.lookupHeader}>
                      <UIText variant="title2">{lookupResult.code}</UIText>
                      <LaneChip lane={lookupResult.lane} />
                    </View>
                    <UIText variant="secondary">{holderLabel(lookupResult)}</UIText>
                    <View style={styles.buttonRow}>
                      <Button label="Mark senior" variant="secondary" size="md" onPress={() => handleVerify('senior')} disabled={lookupBusy} style={styles.grow} />
                      <Button label="Mark pregnant" variant="secondary" size="md" onPress={() => handleVerify('pregnant')} disabled={lookupBusy} style={styles.grow} />
                    </View>
                  </View>
                ) : null}
              </Card>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {selectedCounter ? (
        // Thumb zone: the desk's next action always sits at the bottom, above the tab bar.
        <SafeAreaView edges={['bottom']} style={[styles.bottomBar, { backgroundColor: theme.surface, borderTopColor: theme.hairline }]}>
          {actionError ? (
            <UIText variant="secondaryStrong" color="danger" accessibilityLiveRegion="polite">
              {actionError}
            </UIText>
          ) : null}
          {!current ? (
            <Button
              label="Call next"
              onPress={handleCallNext}
              loading={busy}
              disabled={!deskOpen}
              block
              style={styles.callNext}
              accessibilityHint={deskOpen ? undefined : 'Open this desk first'}
            />
          ) : (
            <>
              {current.status === 'called' ? (
                <View style={styles.buttonRow}>
                  <Button
                    label="Recall"
                    variant="secondary"
                    onPress={() => withHaptics(() => rpc('recall_token', { p_token: current.id }))}
                    disabled={busy || current.recall_count >= 2}
                    style={styles.grow}
                  />
                  <Button
                    label="Skip"
                    variant="danger"
                    onPress={() => withHaptics(() => rpc('skip_token', { p_token: current.id }))}
                    disabled={busy}
                    style={styles.grow}
                    accessibilityHint="Marks this ticket as a no-show"
                  />
                </View>
              ) : null}
              {current.status === 'called' ? (
                <Button
                  label="Serve"
                  onPress={() => withHaptics(() => rpc('start_serving', { p_token: current.id }))}
                  disabled={busy}
                  block
                  style={styles.callNext}
                />
              ) : (
                <Button
                  label="Done"
                  onPress={() => withHaptics(() => rpc('complete_token', { p_token: current.id }))}
                  disabled={busy}
                  block
                  style={styles.callNext}
                />
              )}
            </>
          )}
        </SafeAreaView>
      ) : null}
    </ThemedView>
  );
}

/** Lane as a soft pill: emergency in red, walk-in neutral, priority lanes in cyan. Not a tap target. */
function LaneChip({ lane }: { lane: string }) {
  const theme = useTheme();
  const [bg, fg] =
    lane === 'emergency'
      ? [theme.dangerSoft, theme.danger]
      : ['senior', 'pregnant', 'appointment'].includes(lane)
        ? [theme.primarySoft, theme.primaryText]
        : [theme.surfaceSunken, theme.inkSecondary];
  return (
    <View style={[styles.laneChip, { backgroundColor: bg }]}>
      <UIText variant="secondaryStrong" style={{ color: fg }} numberOfLines={1}>
        {laneLabel(lane)}
      </UIText>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: -Spacing.sm },
  toolbarLink: { minHeight: 44, justifyContent: 'center' },
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingBottom: Spacing.lg, gap: Spacing.sm },
  header: { marginTop: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pickerChip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md + 4,
    minHeight: MIN_TAP,
    justifyContent: 'center',
  },
  segmentedRow: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: Radius.md, marginTop: Spacing.xs },
  segment: { flex: 1, minHeight: MIN_TAP, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  capitalize: { textTransform: 'capitalize' },
  currentCard: { marginTop: Spacing.xs, padding: Spacing.lg, gap: Spacing.xs },
  currentMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs },
  tokenCode: { ...Type.title1, fontSize: 64, lineHeight: 76, letterSpacing: 1 },
  idle: { alignItems: 'center', gap: Spacing.xs, paddingVertical: Spacing.md },
  centerText: { textAlign: 'center' },
  listCard: { paddingVertical: Spacing.xxs, gap: 0 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 64, paddingVertical: Spacing.xs },
  queueText: { flex: 1, gap: 2 },
  laneChip: { borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xxs, alignSelf: 'center' },
  lookupRow: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' },
  lookupInput: {
    ...Type.body,
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TAP,
  },
  lookupResult: { gap: Spacing.xs },
  lookupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  grow: { flexGrow: 1 },
  bottomBar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm, gap: Spacing.xs, borderTopWidth: 1 },
  callNext: { height: 72, borderRadius: Radius.lg },
});
