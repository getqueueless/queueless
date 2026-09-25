import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/** Shared with (app)/_layout.tsx's one-time retry-on-next-boot. */
export const PENDING_NAME_KEY = 'queueless-pending-full-name';

/**
 * First-login-only screen, shown once when `profiles.full_name` is null (always true right
 * after an OTP signup, since OTP creates the account before any name is collected). A display
 * name is cosmetic — a failed write here must never gate taking a token, so errors are caught
 * and silently skipped rather than shown.
 */
export default function NameEntry() {
  const theme = useTheme();
  const router = useRouter();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    const trimmed = name.trim();
    setSubmitting(true);
    if (trimmed) {
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user.id;
        if (userId) {
          const { error } = await supabase.from('profiles').update({ full_name: trimmed }).eq('id', userId);
          if (error) throw error;
          localStorage.removeItem(PENDING_NAME_KEY);
        }
      } catch {
        // profiles RLS for owner-column updates hadn't landed as of this build (see
        // docs/DECISIONS.md) — never block entry into the app over a cosmetic write. Stash it
        // for (app)/_layout.tsx to retry once on next boot instead of losing it.
        localStorage.setItem(PENDING_NAME_KEY, trimmed);
      }
    }
    setSubmitting(false);
    router.replace('/(app)/(tabs)');
  }

  return (
    <ThemedView type="canvasSoft" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView type="surface" style={[styles.card, { borderColor: theme.hairline }]}>
          <ThemedText type="displayMd">What should we call you?</ThemedText>
          <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
            Just a display name — nothing else to fill in.
          </ThemedText>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={theme.inkMuted}
            autoCapitalize="words"
            style={[styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
          />

          <Pressable
            onPress={handleContinue}
            disabled={submitting || !name.trim()}
            style={[styles.button, { backgroundColor: theme.primary, opacity: submitting ? 0.6 : 1 }]}>
            {submitting ? (
              <ActivityIndicator color={theme.onPrimary} />
            ) : (
              <ThemedText type="button" themeColor="onPrimary">
                Continue
              </ThemedText>
            )}
          </Pressable>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.xl,
    padding: Spacing.xl,
    gap: Spacing.sm,
    ...CardShadow,
  },
  subtitle: { marginBottom: Spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    fontSize: 14,
    minHeight: 44,
  },
  button: {
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
    minHeight: 44,
  },
});
