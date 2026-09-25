import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
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

  if (roleLoading || loading) {
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
        <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
          Priority head start
        </ThemedText>
        <ThemedText type="bodySm" themeColor="inkMuted" style={styles.fairnessNote}>
          A senior or pregnant patient gets a head-start on arrival time, not a permanent jump to
          the front — someone who&apos;s been waiting longer still goes first once that head-start
          runs out.
        </ThemedText>

        {loadError ? (
          <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
            {loadError}
          </ThemedText>
        ) : (
          <ThemedView type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }]}>
            <ThemedText type="caption" themeColor="inkMuted">
              Current: {savedValue} minutes
            </ThemedText>
            <View style={styles.inputRow}>
              <TextInput
                value={input}
                onChangeText={(t) => {
                  setInput(t);
                  setSaved(false);
                }}
                keyboardType="number-pad"
                placeholder="15"
                placeholderTextColor={theme.inkMuted}
                style={[styles.input, { color: theme.ink, borderColor: theme.hairline }]}
              />
              <ThemedText type="body" themeColor="inkSecondary">
                minutes
              </ThemedText>
            </View>

            {saveError ? (
              <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
                {saveError}
              </ThemedText>
            ) : saved ? (
              <ThemedText type="bodySm" themeColor="success" style={styles.error}>
                Saved.
              </ThemedText>
            ) : null}

            <Pressable
              onPress={handleSave}
              disabled={!isValid || saving}
              style={[styles.saveButton, { backgroundColor: theme.primary, opacity: !isValid || saving ? 0.5 : 1 }]}>
              {saving ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <ThemedText type="button" themeColor="onPrimary">
                  Save
                </ThemedText>
              )}
            </Pressable>
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  sectionLabel: { marginTop: Spacing.sm },
  fairnessNote: { marginTop: Spacing.xxs, marginBottom: Spacing.md },
  error: { marginTop: Spacing.xs },
  card: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.lg, gap: Spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  input: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
    width: 100,
  },
  saveButton: {
    minHeight: 44,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
});
