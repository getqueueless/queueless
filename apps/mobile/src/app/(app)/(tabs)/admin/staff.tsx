import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { type Role, useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Confirmed against supabase/migrations/0002_organizations_profiles.sql and
// 0028_set_member_role.sql just now: `profiles` has no `email` column (email only lives in
// auth.users, which needs the service_role key mobile must never embed — apps/web has a server
// route for that), so lookup here is by full_name only. `set_member_role` only ever operates on
// an existing profile id — there is no "invite by email" flow; someone with no account yet has
// to sign up first (any way), which is when their profile starts existing with org_id = null.
type ProfileRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: Role;
};

const ROLE_OPTIONS: Role[] = ['patient', 'staff', 'admin'];

async function fetchOrgMembers(orgId: string) {
  return supabase
    .from('profiles')
    .select('id, full_name, phone, role')
    .eq('org_id', orgId)
    .order('full_name', { ascending: true, nullsFirst: false });
}

function memberLabel(p: Pick<ProfileRow, 'full_name' | 'phone'>): string {
  return p.full_name?.trim() || p.phone || 'Unnamed profile';
}

export default function AdminStaff() {
  const theme = useTheme();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [members, setMembers] = useState<ProfileRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [unassigned, setUnassigned] = useState<ProfileRow[]>([]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      setMembersLoading(true);
      const { data, error } = await fetchOrgMembers(orgId);
      if (cancelled) return;
      setMembersLoading(false);
      if (error) {
        setMembersError(mapSupabaseError(error));
        return;
      }
      setMembersError(null);
      setMembers((data ?? []) as ProfileRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  async function reloadMembers() {
    if (!orgId) return;
    const { data, error } = await fetchOrgMembers(orgId);
    if (error) return; // best-effort refresh after an action — the action's own error already showed
    setMembers((data ?? []) as ProfileRow[]);
  }

  async function handleSearch() {
    const q = query.trim();
    if (!q || searchBusy) return;
    setSearchBusy(true);
    setSearchError(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, role')
      .is('org_id', null)
      .eq('role', 'patient')
      .ilike('full_name', `%${q}%`)
      .order('full_name', { ascending: true })
      .limit(20);
    setSearchBusy(false);
    setSearched(true);
    if (error) {
      setSearchError(mapSupabaseError(error));
      return;
    }
    setUnassigned((data ?? []) as ProfileRow[]);
  }

  async function handleSetRole(profile: ProfileRow, role: Role) {
    if (busyId || !orgId || role === profile.role) return;
    setBusyId(profile.id);
    setActionError(null);
    const { error } = await supabase.rpc('set_member_role', { p_user: profile.id, p_role: role, p_org: orgId });
    setBusyId(null);
    if (error) {
      setActionError(mapSupabaseError(error));
      return;
    }
    setUnassigned((prev) => prev.filter((p) => p.id !== profile.id));
    reloadMembers();
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
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
            Org members ({members.length})
          </ThemedText>

          {actionError ? (
            <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
              {actionError}
            </ThemedText>
          ) : null}

          <ThemedView type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }]}>
            {membersLoading ? (
              <ActivityIndicator color={theme.primary} style={styles.cardPadding} />
            ) : membersError ? (
              <ThemedText type="bodySm" themeColor="danger" style={styles.cardPadding}>
                {membersError}
              </ThemedText>
            ) : members.length === 0 ? (
              <ThemedText type="bodySm" themeColor="inkMuted" style={styles.cardPadding}>
                No staff or admins in this org yet.
              </ThemedText>
            ) : (
              members.map((m, i) => (
                <View key={m.id} style={[styles.memberRow, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
                  <View style={styles.memberInfo}>
                    <ThemedText type="bodyLg">{memberLabel(m)}</ThemedText>
                    {m.phone ? (
                      <ThemedText type="caption" themeColor="inkMuted">
                        {m.phone}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View style={styles.roleRow}>
                    {ROLE_OPTIONS.map((role) => {
                      const selected = m.role === role;
                      return (
                        <Pressable
                          key={role}
                          onPress={() => handleSetRole(m, role)}
                          disabled={busyId === m.id}
                          style={[
                            styles.roleChip,
                            {
                              backgroundColor: selected ? theme.dark : 'transparent',
                              borderColor: selected ? theme.dark : theme.hairline,
                              opacity: busyId === m.id ? 0.5 : 1,
                            },
                          ]}>
                          <ThemedText type="caption" themeColor={selected ? 'onPrimary' : 'inkSecondary'} style={styles.capitalize}>
                            {role}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </ThemedView>

          <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
            Promote an unassigned patient
          </ThemedText>
          <ThemedText type="caption" themeColor="inkMuted" style={styles.hint}>
            Search by name — looking someone up by email needs the web admin console.
          </ThemedText>

          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Patient's name"
              placeholderTextColor={theme.inkMuted}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              style={[styles.searchInput, { color: theme.ink, borderColor: theme.hairline }]}
            />
            <Pressable
              onPress={handleSearch}
              disabled={searchBusy || !query.trim()}
              style={[styles.searchButton, { backgroundColor: theme.dark, opacity: searchBusy || !query.trim() ? 0.6 : 1 }]}>
              <ThemedText type="button" themeColor="onPrimary">
                Search
              </ThemedText>
            </Pressable>
          </View>

          {searchError ? (
            <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
              {searchError}
            </ThemedText>
          ) : null}

          {searched && !searchError ? (
            <ThemedView type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }]}>
              {unassigned.length === 0 ? (
                <ThemedText type="bodySm" themeColor="inkMuted" style={styles.cardPadding}>
                  No unassigned patients match that name.
                </ThemedText>
              ) : (
                unassigned.map((p, i) => (
                  <View key={p.id} style={[styles.memberRow, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
                    <View style={styles.memberInfo}>
                      <ThemedText type="bodyLg">{memberLabel(p)}</ThemedText>
                      {p.phone ? (
                        <ThemedText type="caption" themeColor="inkMuted">
                          {p.phone}
                        </ThemedText>
                      ) : null}
                    </View>
                    <View style={styles.roleRow}>
                      <Pressable
                        onPress={() => handleSetRole(p, 'staff')}
                        disabled={busyId === p.id}
                        style={[styles.actionButtonOutline, { borderColor: theme.primaryOutline, opacity: busyId === p.id ? 0.5 : 1 }]}>
                        <ThemedText type="caption" themeColor="primaryText">
                          Make staff
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => handleSetRole(p, 'admin')}
                        disabled={busyId === p.id}
                        style={[styles.actionButtonOutline, { borderColor: theme.primaryOutline, opacity: busyId === p.id ? 0.5 : 1 }]}>
                        <ThemedText type="caption" themeColor="primaryText">
                          Make admin
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ))
              )}
            </ThemedView>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingTop: Spacing.sm, paddingBottom: Spacing.xxl, gap: Spacing.xs },
  sectionLabel: { marginTop: Spacing.md },
  hint: { marginTop: -Spacing.xxs, marginBottom: Spacing.xxs },
  error: { marginTop: Spacing.xxs },
  card: { borderWidth: 1, borderRadius: Rounded.lg },
  cardPadding: { padding: Spacing.md, textAlign: 'center' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  memberInfo: { flexShrink: 1, gap: 2 },
  roleRow: { flexDirection: 'row', gap: Spacing.xxs },
  roleChip: {
    borderWidth: 1,
    borderRadius: Rounded.pill,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capitalize: { textTransform: 'capitalize' },
  actionButtonOutline: {
    borderWidth: 1,
    borderRadius: Rounded.pill,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.xs },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
  },
  searchButton: { minHeight: 44, borderRadius: Rounded.md, paddingHorizontal: Spacing.md, justifyContent: 'center' },
});
