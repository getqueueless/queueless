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

export default function SignIn() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(mapAuthError({ code: signInError.code, message: signInError.message }));
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="displayMd">Welcome back</ThemedText>
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          Sign in to take a token or check your queue position.
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
          placeholder="Password"
          placeholderTextColor={theme.inkMuted}
          autoCapitalize="none"
          autoComplete="password"
          secureTextEntry
          style={[styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
        />

        {error ? (
          <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        <Pressable
          onPress={handleSignIn}
          disabled={submitting || !email || !password}
          style={[styles.button, { backgroundColor: theme.primary, opacity: submitting ? 0.6 : 1 }]}>
          {submitting ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <ThemedText type="button" themeColor="onPrimary">
              Sign in
            </ThemedText>
          )}
        </Pressable>

        <Link href="/(auth)/sign-up" style={styles.link}>
          <ThemedText type="bodySm" themeColor="primary">
            New here? Create an account
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
