import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LabeledInput } from '@/components/admin/labeled-input';
import { StateCard } from '@/components/admin/state-card';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, EmptyState, MIN_TAP, Radius, UIText, type IconName } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Confirmed against 0003_services_counters.sql/0030_rls_public_tables.sql just now: counters has
// no delete policy either — state is the only "remove". `staff_id` exists on the row but has no
// admin-facing write path anywhere in this schema (see counter.tsx's own comment on this) — left
// untouched here on purpose.
type CounterState = 'open' | 'paused' | 'closed';
type CounterRow = { id: string; name: string; state: CounterState };
type ServiceRow = { id: string; name: string };

const COUNTER_STATES: CounterState[] = ['open', 'paused', 'closed'];

export default function AdminCounters() {
  const theme = useTheme();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [counterServices, setCounterServices] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mappingBusyKey, setMappingBusyKey] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    const [countersRes, servicesRes] = await Promise.all([
      supabase.from('counters').select('id, name, state').eq('org_id', orgId).order('name'),
      supabase.from('services').select('id, name').eq('org_id', orgId).order('name'),
    ]);
    if (countersRes.error || servicesRes.error) {
      setLoadError(mapSupabaseError(countersRes.error ?? servicesRes.error));
      setLoading(false);
      return;
    }
    const nextCounters = (countersRes.data ?? []) as CounterRow[];
    setCounters(nextCounters);
    setServices((servicesRes.data ?? []) as ServiceRow[]);

    const counterIds = nextCounters.map((c) => c.id);
    if (counterIds.length > 0) {
      const { data: csRows } = await supabase.from('counter_services').select('counter_id, service_id').in('counter_id', counterIds);
      const map: Record<string, Set<string>> = {};
      for (const row of (csRows ?? []) as { counter_id: string; service_id: string }[]) {
        (map[row.counter_id] ??= new Set()).add(row.service_id);
      }
      setCounterServices(map);
    } else {
      setCounterServices({});
    }
    setLoadError(null);
    setLoading(false);
  }, [orgId]);
  useLiveRefresh(refetch);

  // One channel covering counters + the join table, same shape as counter.tsx: the subscribe
  // callback's SUBSCRIBED case fires the initial load, not a separate bare effect.
  // counter_services has no org_id column to filter on (and no RLS yet — see docs/DECISIONS.md,
  // confirmed against migrations just now) so that leg subscribes unfiltered; fine at this scale.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`admin-counters:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'counters', filter: `org_id=eq.${orgId}` }, () => {
        refetch();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'counter_services' }, () => {
        refetch();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refetch();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, refetch]);

  function startEdit(row: CounterRow) {
    setEditingId(row.id);
    setNameDraft(row.name);
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError(null);
  }

  async function saveName(id: string) {
    if (busyId) return;
    const name = nameDraft.trim();
    if (!name) {
      setRowError('Name is required.');
      return;
    }
    setBusyId(id);
    setRowError(null);
    const { error } = await supabase.from('counters').update({ name }).eq('id', id);
    setBusyId(null);
    if (error) {
      setRowError(mapSupabaseError(error));
      return;
    }
    setEditingId(null);
    refetch();
  }

  async function setState(row: CounterRow, state: CounterState) {
    if (busyId || row.state === state) return;
    setBusyId(row.id);
    setRowError(null);
    const { error } = await supabase.from('counters').update({ state }).eq('id', row.id);
    setBusyId(null);
    if (error) {
      setRowError(mapSupabaseError(error));
      return;
    }
    refetch();
  }

  async function toggleMapping(counterId: string, serviceId: string, mapped: boolean) {
    const key = `${counterId}:${serviceId}`;
    if (mappingBusyKey) return;
    setMappingBusyKey(key);
    setRowError(null);
    const { error } = mapped
      ? await supabase.from('counter_services').delete().eq('counter_id', counterId).eq('service_id', serviceId)
      : await supabase.from('counter_services').insert({ counter_id: counterId, service_id: serviceId });
    setMappingBusyKey(null);
    if (error) {
      setRowError(mapSupabaseError(error));
      return;
    }
    refetch();
  }

  async function handleAdd() {
    if (addBusy || !orgId) return;
    const name = addName.trim();
    if (!name) {
      setAddError('Name is required.');
      return;
    }
    setAddBusy(true);
    setAddError(null);
    const { error } = await supabase.from('counters').insert({ org_id: orgId, name });
    setAddBusy(false);
    if (error) {
      setAddError(mapSupabaseError(error));
      return;
    }
    setAddName('');
    setShowAdd(false);
    refetch();
  }

  if (roleLoading || (orgId && loading)) {
    return (
      <ThemedView type="canvas" style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </ThemedView>
    );
  }

  if (!orgId) {
    return (
      <ThemedView type="canvas" style={styles.container}>
        <View style={styles.center}>
          <StateCard kind="error" message="No organization assigned to this account." />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {loadError ? (
            <StateCard kind="error" message={loadError} />
          ) : counters.length === 0 ? (
            <Card>
              <EmptyState icon={COUNTER_ICON} title="No counters yet" text="Add your first counter below." />
            </Card>
          ) : (
            counters.map((row) => {
              const editing = editingId === row.id;
              const busy = busyId === row.id;
              const mapped = counterServices[row.id] ?? new Set<string>();
              return (
                <Card key={row.id}>
                  {editing ? (
                    <View style={styles.form}>
                      <LabeledInput label="Name" value={nameDraft} onChangeText={setNameDraft} />
                      <View style={styles.actionRow}>
                        <Button label="Save" size="md" loading={busy} onPress={() => saveName(row.id)} style={styles.flex} />
                        <Button label="Cancel" variant="secondary" size="md" disabled={busy} onPress={cancelEdit} />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.cardHeader}>
                      <UIText variant="title3" style={styles.flex}>
                        {row.name}
                      </UIText>
                      <Button label="Rename" variant="ghost" size="md" onPress={() => startEdit(row)} />
                    </View>
                  )}

                  <UIText variant="secondaryStrong" color="inkSecondary" accessibilityRole="header">
                    State
                  </UIText>
                  <View style={styles.segmentedRow}>
                    {COUNTER_STATES.map((state) => {
                      const selected = row.state === state;
                      return (
                        <Pressable
                          key={state}
                          onPress={() => setState(row, state)}
                          disabled={busy}
                          accessibilityRole="radio"
                          accessibilityLabel={state}
                          accessibilityState={{ selected, disabled: busy }}
                          style={[
                            styles.segment,
                            {
                              backgroundColor: selected ? theme.primary : 'transparent',
                              borderColor: selected ? theme.primary : theme.hairlineStrong,
                              opacity: busy ? 0.6 : 1,
                            },
                          ]}>
                          <UIText variant={selected ? 'secondaryStrong' : 'secondary'} color={selected ? 'onPrimary' : 'ink'} style={styles.capitalize}>
                            {state}
                          </UIText>
                        </Pressable>
                      );
                    })}
                  </View>

                  <UIText variant="secondaryStrong" color="inkSecondary" accessibilityRole="header">
                    Serves
                  </UIText>
                  {services.length === 0 ? (
                    <UIText variant="secondary">No services to map yet.</UIText>
                  ) : (
                    <View style={styles.chipRow}>
                      {services.map((service) => {
                        const isMapped = mapped.has(service.id);
                        const key = `${row.id}:${service.id}`;
                        const chipBusy = mappingBusyKey === key;
                        return (
                          <Pressable
                            key={service.id}
                            onPress={() => toggleMapping(row.id, service.id, isMapped)}
                            disabled={mappingBusyKey !== null}
                            accessibilityRole="checkbox"
                            accessibilityLabel={service.name}
                            accessibilityState={{ checked: isMapped, busy: chipBusy }}
                            style={[
                              styles.chip,
                              {
                                backgroundColor: isMapped ? theme.primarySoft : 'transparent',
                                borderColor: isMapped ? theme.primaryOutline : theme.hairlineStrong,
                                opacity: chipBusy ? 0.6 : 1,
                              },
                            ]}>
                            <UIText variant={isMapped ? 'secondaryStrong' : 'secondary'} color={isMapped ? 'primaryText' : 'ink'}>
                              {isMapped ? `✓ ${service.name}` : service.name}
                            </UIText>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {rowError ? (
                    <UIText variant="secondary" color="danger">
                      {rowError}
                    </UIText>
                  ) : null}
                </Card>
              );
            })
          )}

          {showAdd ? (
            <Card>
              <UIText variant="title3" accessibilityRole="header">
                New counter
              </UIText>
              <View style={styles.form}>
                <LabeledInput label="Name" value={addName} onChangeText={setAddName} />
                {addError ? (
                  <UIText variant="secondary" color="danger">
                    {addError}
                  </UIText>
                ) : null}
                <View style={styles.actionRow}>
                  <Button label="Add counter" size="md" loading={addBusy} onPress={handleAdd} style={styles.flex} />
                  <Button label="Cancel" variant="secondary" size="md" onPress={() => setShowAdd((v) => !v)} />
                </View>
              </View>
            </Card>
          ) : (
            <Button label="Add counter" variant="secondary" icon={PLUS_ICON} block onPress={() => setShowAdd((v) => !v)} />
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const COUNTER_ICON: IconName = { ios: 'tray', android: 'inbox', web: 'inbox' };
const PLUS_ICON: IconName = { ios: 'plus', android: 'add', web: 'add' };

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.md },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  flex: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, minHeight: MIN_TAP },
  form: { gap: Spacing.sm },
  actionRow: { flexDirection: 'row', gap: Spacing.xs },
  segmentedRow: { flexDirection: 'row', gap: Spacing.xs },
  segment: { flex: 1, minHeight: MIN_TAP, borderWidth: 1, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  capitalize: { textTransform: 'capitalize' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    minHeight: MIN_TAP,
    minWidth: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
