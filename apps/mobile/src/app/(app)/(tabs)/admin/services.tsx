import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LabeledInput } from '@/components/admin/labeled-input';
import { StateCard } from '@/components/admin/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
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
            <StateCard kind="empty" message="No services yet — add one below." />
          ) : (
            services.map((row) => {
              const editing = editingId === row.id;
              const busy = busyId === row.id;
              return (
                <ThemedView key={row.id} type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }]}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderText}>
                      <ThemedText type="headingSm">{row.name}</ThemedText>
                      <ThemedText type="caption" themeColor="inkMuted">
                        Code {row.code}
                      </ThemedText>
                    </View>
                    <Switch
                      value={row.is_open}
                      onValueChange={() => toggleOpen(row)}
                      disabled={busy}
                      trackColor={{ false: theme.hairline, true: theme.primaryOutline }}
                      thumbColor={row.is_open ? theme.primary : theme.surface}
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
                        <ThemedText type="bodySm" themeColor="danger">
                          {rowError}
                        </ThemedText>
                      ) : null}

                      <View style={styles.actionRow}>
                        <Pressable
                          onPress={() => saveEdit(row.id)}
                          disabled={busy}
                          style={[styles.actionButton, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}>
                          {busy ? <ActivityIndicator color={theme.onPrimary} /> : <ThemedText type="button" themeColor="onPrimary">Save</ThemedText>}
                        </Pressable>
                        <Pressable onPress={cancelEdit} disabled={busy} style={[styles.actionButtonOutline, { borderColor: theme.hairline }]}>
                          <ThemedText type="button" themeColor="ink">
                            Cancel
                          </ThemedText>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.form}>
                      <ThemedText type="bodySm" themeColor="inkSecondary">
                        {row.default_service_secs}s/token · no-show after {row.no_show_minutes}m · max {row.max_tokens_per_day}/day
                      </ThemedText>
                      <Pressable onPress={() => startEdit(row)} style={[styles.actionButtonOutline, { borderColor: theme.hairline }]}>
                        <ThemedText type="button" themeColor="ink">
                          Edit
                        </ThemedText>
                      </Pressable>
                    </View>
                  )}
                </ThemedView>
              );
            })
          )}

          <ThemedView type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }]}>
            <Pressable onPress={() => setShowAdd((v) => !v)} style={styles.addToggle}>
              <ThemedText type="headingSm">{showAdd ? 'Cancel' : '+ Add service'}</ThemedText>
            </Pressable>
            {showAdd ? (
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
                  <ThemedText type="bodySm" themeColor="danger">
                    {addError}
                  </ThemedText>
                ) : null}

                <Pressable
                  onPress={handleAdd}
                  disabled={addBusy}
                  style={[styles.actionButton, { backgroundColor: theme.primary, opacity: addBusy ? 0.6 : 1 }]}>
                  {addBusy ? <ActivityIndicator color={theme.onPrimary} /> : <ThemedText type="button" themeColor="onPrimary">Add service</ThemedText>}
                </Pressable>
              </View>
            ) : null}
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  card: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.md, gap: Spacing.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeaderText: { gap: 2 },
  form: { gap: Spacing.xs },
  actionRow: { flexDirection: 'row', gap: Spacing.xs },
  actionButton: {
    flexGrow: 1,
    minHeight: 44,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  actionButtonOutline: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  addToggle: { minHeight: 44, justifyContent: 'center' },
});
