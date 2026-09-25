import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapAuthError } from '@/lib/errors';
import { unregisterPushTokenAsync } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme-preference';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function Settings() {
  const theme = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themePref, setThemePref] = useState(getThemePreference);

  async function handleSignOut() {
    setError(null);
    setSigningOut(true);
    // Before signOut: once signed out, RLS can't see the row and the delete would match 0 rows.
    await unregisterPushTokenAsync();
    const { error: signOutError } = await supabase.auth.signOut();
    // No manual redirect on success — (app)/_layout.tsx watches the session and redirects
    // to (auth) once it goes null. On failure, stop spinning and let the patient retry.
    if (signOutError) {
      setSigningOut(false);
      setError(mapAuthError({ code: signOutError.code, message: signOutError.message }));
    }
  }

  function handleThemePress(pref: ThemePreference) {
    setThemePreference(pref);
    setThemePref(pref);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="displayMd" style={styles.title}>
          Settings
        </ThemedText>

        <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
          Language
        </ThemedText>
        <ThemedView type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }]}>
          <View style={[styles.languageRow, { borderColor: theme.hairline }]}>
            <ThemedText type="bodyLg">English</ThemedText>
            <ThemedView type="primary" style={styles.activePill}>
              <ThemedText type="caption" themeColor="onPrimary">
                Active
              </ThemedText>
            </ThemedView>
          </View>
          <View style={[styles.languageRow, styles.languageRowLast]}>
            <ThemedText type="bodyLg" themeColor="inkMuted">
              हिन्दी (Hindi)
            </ThemedText>
            <ThemedText type="caption" themeColor="inkMuted">
              Coming soon
            </ThemedText>
          </View>
        </ThemedView>

        <ThemedText type="headingMd" themeColor="inkSecondary" style={[styles.sectionLabel, styles.sectionSpacer]}>
          Appearance
        </ThemedText>
        <ThemedView
          type="surface"
          style={[styles.card, styles.appearanceCard, CardShadow, { borderColor: theme.hairline }]}>
          <View style={styles.segmentedRow}>
            {THEME_OPTIONS.map((option) => {
              const selected = themePref === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => handleThemePress(option.value)}
                  style={[
                    styles.segment,
                    {
                      backgroundColor: selected ? theme.primary : 'transparent',
                      borderColor: selected ? theme.primary : theme.hairline,
                    },
                  ]}>
                  <ThemedText type="button" themeColor={selected ? 'onPrimary' : 'inkSecondary'}>
                    {option.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </ThemedView>

        <View style={styles.spacer} />

        {error ? (
          <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        <Pressable
          onPress={handleSignOut}
          disabled={signingOut}
          style={[
            styles.signOutButton,
            CardShadow,
            { backgroundColor: theme.surface, borderColor: theme.hairline, opacity: signingOut ? 0.6 : 1 },
          ]}>
          {signingOut ? (
            <ActivityIndicator color={theme.danger} />
          ) : (
            <ThemedText type="button" themeColor="danger">
              Sign out
            </ThemedText>
          )}
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  title: { marginTop: Spacing.sm, marginBottom: Spacing.lg },
  sectionLabel: { marginBottom: Spacing.xs },
  sectionSpacer: { marginTop: Spacing.lg },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  languageRowLast: { borderBottomWidth: 0 },
  activePill: {
    borderRadius: Rounded.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  appearanceCard: {
    padding: Spacing.sm,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { flex: 1, minHeight: Spacing.xl },
  error: { marginBottom: Spacing.sm, textAlign: 'center' },
  signOutButton: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
});
