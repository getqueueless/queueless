import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapAuthError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export default function SignUp() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignUp() {
    setError(null);
    setSubmitting(true);
    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    setSubmitting(false);
    if (signUpError) {
      setError(mapAuthError({ code: signUpError.code, message: signUpError.message }));
    }
    // Autoconfirm is on server-side, so a successful signUp already returns a session —
    // the (auth) layout's own useSession subscription picks it up and redirects.
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="displayMd">Create your account</ThemedText>
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          Used to tie your tokens and appointments to you — no phone number needed.
        </ThemedText>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={theme.inkMuted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          style={[styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password (min 6 characters)"
          placeholderTextColor={theme.inkMuted}
          autoCapitalize="none"
          autoComplete="password-new"
          secureTextEntry
          style={[styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
        />

        {error ? (
          <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        <Pressable
          onPress={handleSignUp}
          disabled={submitting || !email || password.length < 6}
          style={[styles.button, { backgroundColor: theme.primary, opacity: submitting ? 0.6 : 1 }]}>
          {submitting ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <ThemedText type="button" themeColor="onPrimary">
              Create account
            </ThemedText>
          )}
        </Pressable>

        <Link href="/(auth)/sign-in" style={styles.link}>
          <ThemedText type="bodySm" themeColor="primary">
            Already have an account? Sign in
          </ThemedText>
        </Link>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  subtitle: { marginBottom: Spacing.md },
  input: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    fontSize: 14,
    minHeight: 44,
  },
  error: { marginTop: Spacing.xxs },
  button: {
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
    minHeight: 44,
  },
  link: { marginTop: Spacing.md, alignSelf: 'center' },
});
