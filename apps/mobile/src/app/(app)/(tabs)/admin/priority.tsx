import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LabeledInput } from '@/components/admin/labeled-input';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, SectionHeader, UIText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Confirmed against supabase/migrations/0002_organizations_profiles.sql and
// 0030_rls_public_tables.sql just now: the only org-level priority knob is
// `organizations.priority_head_start_minutes` (int, default 15), and its whole write path is a
// direct RLS-gated update (admin of their own org) — no RPC. `services.no_show_minutes` is a
// separate, per-service setting that belongs on the Services screen, not here.
export default function AdminPriority() {
  const theme = useTheme();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedValue, setSavedValue] = useState<number | null>(null);
  const [input, setInput] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('organizations')
        .select('priority_head_start_minutes')
        .eq('id', orgId)
        .single();
      if (cancelled) return;
      setLoading(false);
      if (error || !data) {
        setLoadError(mapSupabaseError(error));
        return;
      }
      setLoadError(null);
      setSavedValue(data.priority_head_start_minutes as number);
      setInput(String(data.priority_head_start_minutes));
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const parsed = Number(input);
  const isValid = input.trim() !== '' && Number.isInteger(parsed) && parsed >= 0;

  async function handleSave() {
    if (!orgId || !isValid || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    const { error } = await supabase
      .from('organizations')
      .update({ priority_head_start_minutes: parsed })
      .eq('id', orgId);
    setSaving(false);
    if (error) {
      setSaveError(mapSupabaseError(error));
      return;
    }
    setSavedValue(parsed);
    setSaved(true);
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

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <SectionHeader title="Priority head start" accent="head start" />
        <UIText variant="secondary">
          A senior or pregnant patient gets a head-start on arrival time, not a permanent jump to
          the front — someone who&apos;s been waiting longer still goes first once that head-start
          runs out.
        </UIText>

        {loadError || !orgId ? (
          <UIText variant="secondary" color="danger">
            {loadError ?? 'No organization assigned to this account.'}
          </UIText>
        ) : (
          <Card style={styles.card}>
            <View>
              <UIText variant="secondary">Current head start</UIText>
              <UIText variant="title2">{savedValue} min</UIText>
            </View>
            <LabeledInput
              label="New head start (minutes)"
              value={input}
              onChangeText={(t) => {
                setInput(t);
                setSaved(false);
              }}
              keyboardType="number-pad"
              placeholder="15"
            />

            {saveError ? (
              <UIText variant="secondary" color="danger">
                {saveError}
              </UIText>
            ) : saved ? (
              <UIText variant="secondaryStrong" color="success">
                Saved.
              </UIText>
            ) : null}

            <Button label="Save" block loading={saving} disabled={!isValid} onPress={handleSave} />
          </Card>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.md, paddingTop: Spacing.md, gap: Spacing.sm },
  card: { marginTop: Spacing.xs, gap: Spacing.md },
});
