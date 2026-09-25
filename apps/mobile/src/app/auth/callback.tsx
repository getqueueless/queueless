import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { exchangeAuthRedirect } from '@/lib/auth-redirect';
import { mapAuthError } from '@/lib/errors';
import { routeAfterAuth } from '@/lib/route-after-auth';
import { supabase } from '@/lib/supabase';

// Landing screen for queueless://auth/callback: an emailed sign-in link, a password-reset link,
// or (on Android) the Google redirect. Lives outside (auth) so that group's "signed in -> tabs"
// redirect can't yank the user away mid password reset (and blocks Android back while resetting).

const MIN_PASSWORD = 8;

export default function AuthCallback() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; sb_flow_id?: string; error_description?: string }>();
  const { code, sb_flow_id: flowId, error_description: errorDescription } = params;

  const [state, setState] = useState<'working' | 'recovery' | 'error'>('working');
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await exchangeAuthRedirect({ code, sb_flow_id: flowId, error_description: errorDescription });
      if (cancelled) return;
      if (!result.ok) {
        // A replayed, already-used link (Android relaunch from recents) fails the exchange but
        // the first use already signed the user in: carry on instead of showing an error.
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) return routeAfterAuth(router);
        setMessage(result.message);
        setState('error');
      } else if (result.recovery) {
        setState('recovery');
      } else {
        await routeAfterAuth(router);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, flowId, errorDescription, router]);

  // A reset session is a real session: Android's back button would pop to (auth), whose layout
  // sends any session to the tabs before a new password is saved. Hold the user here instead.
  useEffect(() => {
    if (state !== 'recovery') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [state]);

  async function saveNewPassword() {
    if (password.length < MIN_PASSWORD) {
      setMessage(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      setMessage(mapAuthError({ code: error.code, message: error.message }));
      return;
    }
    await routeAfterAuth(router);
  }

  return (
    <ThemedView type="canvasSoft" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView type="surface" style={[styles.card, { borderColor: theme.hairline }]}>
          {state === 'working' ? (
            <>
              <ActivityIndicator color={theme.primary} />
              <ThemedText type="body" themeColor="inkSecondary" style={styles.center}>
                Signing you in…
              </ThemedText>
            </>
          ) : state === 'recovery' ? (
            <>
              <ThemedText type="displayMd">Choose a new password</ThemedText>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={`New password (${MIN_PASSWORD}+ characters)`}
                placeholderTextColor={theme.inkMuted}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                style={[styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
              />
              {message ? (
                <ThemedText type="bodySm" themeColor="danger">
                  {message}
                </ThemedText>
              ) : null}
              <Pressable
                onPress={saveNewPassword}
                disabled={saving}
                accessibilityRole="button"
                style={[styles.button, { backgroundColor: theme.primary, opacity: saving ? 0.6 : 1 }]}>
                {saving ? (
                  <ActivityIndicator color={theme.onPrimary} />
                ) : (
                  <ThemedText type="button" themeColor="onPrimary">
                    Save password
                  </ThemedText>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText type="displayMd">Link didn&apos;t work</ThemedText>
              <ThemedText type="body" themeColor="inkSecondary">
                {message}
              </ThemedText>
              <Pressable
                onPress={() => router.replace('/(auth)')}
                accessibilityRole="button"
                style={[styles.button, { backgroundColor: theme.primary }]}>
                <ThemedText type="button" themeColor="onPrimary">
                  Back to sign in
                </ThemedText>
              </Pressable>
            </>
          )}
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  card: { borderWidth: 1, borderRadius: Rounded.xl, padding: Spacing.xl, gap: Spacing.sm, ...CardShadow },
  center: { textAlign: 'center' },
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
