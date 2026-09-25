import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signOut } from '@/lib/sign-out';
import { supabase } from '@/lib/supabase';
import {
  getLanguagePreference,
  LANGUAGE_LABELS,
  setLanguagePreference,
  type LanguagePreference,
} from '@/lib/language-preference';
import { getThemePreference, setThemePreference, type ThemePreference } from '@/lib/theme-preference';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const LANGUAGE_OPTIONS: LanguagePreference[] = ['en', 'hi', 'pa'];

export default function Settings() {
  const theme = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themePref, setThemePref] = useState(getThemePreference);
  const [languagePref, setLanguagePref] = useState(getLanguagePreference);

  async function handleSignOut() {
    setError(null);
    setSigningOut(true);
    // On failure, stop spinning and let the user retry; success redirects via (app)/_layout.
    const message = await signOut();
    if (message) {
      setSigningOut(false);
      setError(message);
    }
  }

  function handleThemePress(pref: ThemePreference) {
    setThemePreference(pref);
    setThemePref(pref);
  }

  function handleLanguagePress(pref: LanguagePreference) {
    setLanguagePreference(pref);
    setLanguagePref(pref);
    // Best-effort write-through to profiles.language (supabase/migrations/0035) — local storage
    // stays the primary, instant source of truth for this device (matches theme-preference's
    // own pattern); the server copy just lets other surfaces (e.g. apps/api's push-notification
    // translation) see the choice too. Never blocks or surfaces an error for this.
    supabase.rpc('set_my_language', { p_language: pref }).then(({ error }) => {
      if (error) console.log('[settings] set_my_language failed (non-fatal):', error);
    });
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
        <ThemedText type="bodySm" themeColor="inkMuted" style={styles.languageNote}>
          The app&apos;s own screens are English-only for now — this saves your preference for
          notifications and future translated content.
        </ThemedText>
        <ThemedView
          type="surface"
          style={[styles.card, styles.appearanceCard, CardShadow, { borderColor: theme.hairline }]}>
          <View style={styles.segmentedRow}>
            {LANGUAGE_OPTIONS.map((option) => {
              const selected = languagePref === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => handleLanguagePress(option)}
                  style={[
                    styles.segment,
                    {
                      backgroundColor: selected ? theme.primary : 'transparent',
                      borderColor: selected ? theme.primary : theme.hairline,
                    },
                  ]}>
                  <ThemedText type="button" themeColor={selected ? 'onPrimary' : 'inkSecondary'}>
                    {LANGUAGE_LABELS[option]}
                  </ThemedText>
                </Pressable>
              );
            })}
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
  languageNote: { marginBottom: Spacing.sm },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
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
