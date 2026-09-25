import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LabeledInput } from '@/components/admin/labeled-input';
import { StateCard } from '@/components/admin/state-card';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, EmptyState, MIN_TAP, UIText, type IconName } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Confirmed against supabase/migrations/0003_services_counters.sql and 0030_rls_public_tables.sql
// just now: services has no delete policy anywhere (rows are referenced by history) — is_open is
// the only "remove" a service gets. A plain `.update()`/`.insert()` works for an admin of this
// org, no RPC needed (policy: org_id = private.my_org() and private.my_role() = 'admin').
type ServiceRow = {
  id: string;
  code: string;
  name: string;
  is_open: boolean;
  default_service_secs: number;
  no_show_minutes: number;
  max_tokens_per_day: number;
};

// Editable numeric fields are kept as strings while being typed — parsed/validated on Save so a
// mid-edit empty field or stray character doesn't fire a network call.
type Draft = {
  name: string;
  code: string;
  default_service_secs: string;
  no_show_minutes: string;
  max_tokens_per_day: string;
};

function toDraft(row: ServiceRow): Draft {
  return {
    name: row.name,
    code: row.code,
    default_service_secs: String(row.default_service_secs),
    no_show_minutes: String(row.no_show_minutes),
    max_tokens_per_day: String(row.max_tokens_per_day),
  };
}

const EMPTY_DRAFT: Draft = { name: '', code: '', default_service_secs: '300', no_show_minutes: '5', max_tokens_per_day: '500' };

/** Returns the parsed fields, or a validation message if something doesn't parse. */
function parseDraft(draft: Draft): { ok: true; value: Omit<ServiceRow, 'id' | 'is_open'> } | { ok: false; error: string } {
  const name = draft.name.trim();
  const code = draft.code.trim().toUpperCase();
  const defaultServiceSecs = Number(draft.default_service_secs);
  const noShowMinutes = Number(draft.no_show_minutes);
  const maxTokensPerDay = Number(draft.max_tokens_per_day);
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!code || code.length > 3) return { ok: false, error: 'Code must be 1-3 characters.' };
  if (!Number.isFinite(defaultServiceSecs) || defaultServiceSecs <= 0) return { ok: false, error: 'Default service time must be a positive number.' };
  if (!Number.isFinite(noShowMinutes) || noShowMinutes <= 0) return { ok: false, error: 'No-show minutes must be a positive number.' };
  if (!Number.isFinite(maxTokensPerDay) || maxTokensPerDay <= 0) return { ok: false, error: 'Max tokens/day must be a positive number.' };
  return {
    ok: true,
    value: { name, code, default_service_secs: defaultServiceSecs, no_show_minutes: noShowMinutes, max_tokens_per_day: maxTokensPerDay },
  };
}

export default function AdminServices() {
  const theme = useTheme();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase
      .from('services')
      .select('id, code, name, is_open, default_service_secs, no_show_minutes, max_tokens_per_day')
      .eq('org_id', orgId)
      .order('name');
    if (error) {
      setLoadError(mapSupabaseError(error));
      setLoading(false);
      return;
    }
    setServices((data ?? []) as ServiceRow[]);
    setLoadError(null);
    setLoading(false);
  }, [orgId]);
  useLiveRefresh(refetch);

  // Same shape as counter.tsx: one channel, initial load fired from the subscribe callback's
  // SUBSCRIBED case rather than a separate bare effect.
  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`admin-services:${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'services', filter: `org_id=eq.${orgId}` }, () => {
        refetch();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refetch();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, refetch]);

  function startEdit(row: ServiceRow) {
    setEditingId(row.id);
    setDraft(toDraft(row));
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setRowError(null);
  }

  async function saveEdit(id: string) {
    if (busyId) return;
    const parsed = parseDraft(draft);
    if (!parsed.ok) {
      setRowError(parsed.error);
      return;
    }
    setBusyId(id);
    setRowError(null);
    const { error } = await supabase.from('services').update(parsed.value).eq('id', id);
    setBusyId(null);
    if (error) {
      setRowError(mapSupabaseError(error));
      return;
    }
    setEditingId(null);
    refetch();
  }

  async function toggleOpen(row: ServiceRow) {
    if (busyId) return;
    setBusyId(row.id);
    const { error } = await supabase.from('services').update({ is_open: !row.is_open }).eq('id', row.id);
    setBusyId(null);
    if (error) {
      setRowError(mapSupabaseError(error));
      return;
    }
    refetch();
  }

  async function handleAdd() {
    if (addBusy || !orgId) return;
    const parsed = parseDraft(addDraft);
    if (!parsed.ok) {
      setAddError(parsed.error);
      return;
    }
    setAddBusy(true);
    setAddError(null);
    const { error } = await supabase.from('services').insert({ ...parsed.value, org_id: orgId });
    setAddBusy(false);
    if (error) {
      setAddError(mapSupabaseError(error));
      return;
    }
    setAddDraft(EMPTY_DRAFT);
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
          ) : services.length === 0 ? (
            <Card>
              <EmptyState icon={LIST_ICON} title="No services yet" text="Add your first service below." />
            </Card>
          ) : (
            services.map((row) => {
              const editing = editingId === row.id;
              const busy = busyId === row.id;
              return (
                <Card key={row.id}>
                  <View style={styles.headerText}>
                    <UIText variant="title3">{row.name}</UIText>
                    <UIText variant="secondary">Code {row.code}</UIText>
                  </View>

                  <View style={[styles.switchRow, { borderColor: theme.hairline }]}>
                    <UIText variant="bodyStrong" color={row.is_open ? 'success' : 'inkSecondary'} style={styles.flex}>
                      {row.is_open ? 'Open for tokens' : 'Closed'}
                    </UIText>
                    <Switch
                      value={row.is_open}
                      onValueChange={() => toggleOpen(row)}
                      disabled={busy}
                      accessibilityLabel={`${row.name} open for tokens`}
                      trackColor={{ false: theme.hairlineStrong, true: theme.primary }}
                      ios_backgroundColor={theme.hairlineStrong}
                      thumbColor="#ffffff"
                    />
                  </View>

                  {editing ? (
                    <View style={styles.form}>
                      <LabeledInput label="Name" value={draft.name} onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))} />
                      <LabeledInput
                        label="Code (1-3 chars)"
                        value={draft.code}
                        onChangeText={(v) => setDraft((d) => ({ ...d, code: v }))}
                        autoCapitalize="characters"
                        maxLength={3}
                      />
                      <LabeledInput
                        label="Default service time (sec)"
                        value={draft.default_service_secs}
                        onChangeText={(v) => setDraft((d) => ({ ...d, default_service_secs: v }))}
                        keyboardType="number-pad"
                      />
                      <LabeledInput
                        label="No-show minutes"
                        value={draft.no_show_minutes}
                        onChangeText={(v) => setDraft((d) => ({ ...d, no_show_minutes: v }))}
                        keyboardType="number-pad"
                      />
                      <LabeledInput
                        label="Max tokens/day"
                        value={draft.max_tokens_per_day}
                        onChangeText={(v) => setDraft((d) => ({ ...d, max_tokens_per_day: v }))}
                        keyboardType="number-pad"
                      />

                      {rowError ? (
                        <UIText variant="secondary" color="danger">
                          {rowError}
                        </UIText>
                      ) : null}

                      <View style={styles.actionRow}>
                        <Button label="Save" size="md" loading={busy} onPress={() => saveEdit(row.id)} style={styles.flex} />
                        <Button label="Cancel" variant="secondary" size="md" disabled={busy} onPress={cancelEdit} />
                      </View>
                    </View>
                  ) : (
                    <>
                      <UIText variant="secondary">
                        {row.default_service_secs}s per token · no-show after {row.no_show_minutes} min · max {row.max_tokens_per_day}/day
                      </UIText>
                      <Button label="Edit" variant="secondary" size="md" onPress={() => startEdit(row)} />
                    </>
                  )}
                </Card>
              );
            })
          )}

          {showAdd ? (
            <Card>
              <UIText variant="title3" accessibilityRole="header">
                New service
              </UIText>
              <View style={styles.form}>
                <LabeledInput label="Name" value={addDraft.name} onChangeText={(v) => setAddDraft((d) => ({ ...d, name: v }))} />
                <LabeledInput
                  label="Code (1-3 chars)"
                  value={addDraft.code}
                  onChangeText={(v) => setAddDraft((d) => ({ ...d, code: v }))}
                  autoCapitalize="characters"
                  maxLength={3}
                />
                <LabeledInput
                  label="Default service time (sec)"
                  value={addDraft.default_service_secs}
                  onChangeText={(v) => setAddDraft((d) => ({ ...d, default_service_secs: v }))}
                  keyboardType="number-pad"
                />
                <LabeledInput
                  label="No-show minutes"
                  value={addDraft.no_show_minutes}
                  onChangeText={(v) => setAddDraft((d) => ({ ...d, no_show_minutes: v }))}
                  keyboardType="number-pad"
                />
                <LabeledInput
                  label="Max tokens/day"
                  value={addDraft.max_tokens_per_day}
                  onChangeText={(v) => setAddDraft((d) => ({ ...d, max_tokens_per_day: v }))}
                  keyboardType="number-pad"
                />

                {addError ? (
                  <UIText variant="secondary" color="danger">
                    {addError}
                  </UIText>
                ) : null}

                <View style={styles.actionRow}>
                  <Button label="Add service" size="md" loading={addBusy} onPress={handleAdd} style={styles.flex} />
                  <Button label="Cancel" variant="secondary" size="md" onPress={() => setShowAdd((v) => !v)} />
                </View>
              </View>
            </Card>
          ) : (
            <Button label="Add service" variant="secondary" icon={PLUS_ICON} block onPress={() => setShowAdd((v) => !v)} />
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const LIST_ICON: IconName = { ios: 'list.bullet', android: 'list', web: 'list' };
const PLUS_ICON: IconName = { ios: 'plus', android: 'add', web: 'add' };

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.md },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  flex: { flex: 1 },
  headerText: { gap: 2 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: MIN_TAP,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  form: { gap: Spacing.sm },
  actionRow: { flexDirection: 'row', gap: Spacing.xs },
});
