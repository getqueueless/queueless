import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Card, MIN_TAP, Radius, SectionHeader, UIText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
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

// Prod staff accounts are seeded with no name or phone; the id prefix keeps them apart.
function memberLabel(p: Pick<ProfileRow, 'id' | 'full_name' | 'phone'>): string {
  return p.full_name?.trim() || p.phone || `Unnamed (${p.id.slice(0, 8)})`;
}

export default function AdminStaff() {
  const theme = useTheme();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [members, setMembers] = useState<ProfileRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);


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
          <SectionHeader title={`Org members (${members.length})`} />

          {actionError ? (
            <UIText variant="secondary" color="danger">
              {actionError}
            </UIText>
          ) : null}

          <Card style={styles.listCard}>
            {membersLoading ? (
              <ActivityIndicator color={theme.primary} style={styles.cardPadding} />
            ) : membersError ? (
              <UIText color="danger" style={styles.cardPadding}>
                {membersError}
              </UIText>
            ) : members.length === 0 ? (
              <UIText color="inkSecondary" style={styles.cardPadding}>
                No staff or admins in this org yet.
              </UIText>
            ) : (
              members.map((m, i) => (
                <View key={m.id} style={[styles.memberRow, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
                  <View style={styles.memberInfo}>
                    <UIText variant="bodyStrong">{memberLabel(m)}</UIText>
                    {m.phone ? <UIText variant="secondary">{m.phone}</UIText> : null}
                  </View>
                  <View style={styles.roleRow}>
                    {ROLE_OPTIONS.map((role) => {
                      const selected = m.role === role;
                      const busy = busyId === m.id;
                      return (
                        <Pressable
                          key={role}
                          onPress={() => handleSetRole(m, role)}
                          disabled={busy}
                          accessibilityRole="radio"
                          accessibilityLabel={`${memberLabel(m)}: ${role}`}
                          accessibilityState={{ selected, disabled: busy }}
                          style={[
                            styles.roleChip,
                            {
                              backgroundColor: selected ? theme.primary : 'transparent',
                              borderColor: selected ? theme.primary : theme.hairlineStrong,
                              opacity: busy ? 0.5 : 1,
                            },
                          ]}>
                          <UIText variant={selected ? 'secondaryStrong' : 'secondary'} color={selected ? 'onPrimary' : 'ink'} style={styles.capitalize}>
                            {role}
                          </UIText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </Card>

          <View style={styles.sectionGap}>
            <SectionHeader title="Add staff" accent="staff" />
          </View>
          {/* set_member_role now refuses patient -> staff (patient_reassignment_blocked) and 0045
              hides profiles outside the org, so new staff are invited from the web admin. */}
          <UIText variant="secondary">
            New staff are invited from the web admin console (lpu.lol/admin/staff). Patient accounts can&apos;t be
            turned into staff accounts.
          </UIText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.md },
  scroll: { paddingTop: Spacing.md, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  sectionGap: { marginTop: Spacing.md },
  flex: { flex: 1 },
  listCard: { paddingVertical: Spacing.xxs, gap: 0 },
  cardPadding: { paddingVertical: Spacing.md, textAlign: 'center' },
  memberRow: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  memberInfo: { gap: 2 },
  roleRow: { flexDirection: 'row', gap: Spacing.xs },
  roleChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.sm,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capitalize: { textTransform: 'capitalize' },
});
