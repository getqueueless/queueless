import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, Radius, Type, UIText, type IconName } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { exchangeAuthRedirect } from '@/lib/auth-redirect';
import { mapAuthError } from '@/lib/errors';
import { routeAfterAuth } from '@/lib/route-after-auth';
import { supabase } from '@/lib/supabase';

// Landing screen for queueless://auth/callback: an emailed sign-in link, a password-reset link,
// or (on Android) the Google redirect. Lives outside (auth) so that group's "signed in -> tabs"
// redirect can't yank the user away mid password reset (and blocks Android back while resetting).

const MIN_PASSWORD = 8;
const ERROR_ICON: IconName = { ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' };

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
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Card style={styles.card}>
            {state === 'working' ? (
              <>
                <ActivityIndicator size="large" color={theme.primary} />
                <UIText variant="body" color="inkSecondary" style={styles.center}>
                  Signing you in…
                </UIText>
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
                  style={[
                    styles.input,
                    {
                      color: theme.ink,
                      backgroundColor: theme.surfaceSunken,
                      borderColor: message ? theme.danger : theme.hairlineStrong,
                      borderWidth: message ? 2 : 1,
                    },
                  ]}
                />
                {message ? (
                  <View
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[styles.banner, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
                    <SymbolView name={ERROR_ICON} size={22} tintColor={theme.danger} />
                    <UIText variant="secondaryStrong" color="danger" style={styles.bannerText}>
                      {message}
                    </UIText>
                  </View>
                ) : null}
                <Button label="Save password" onPress={saveNewPassword} size="lg" block loading={saving} style={styles.button} />
              </>
            ) : (
              <>
                <SymbolView name={ERROR_ICON} size={40} tintColor={theme.danger} />
                <ThemedText type="displayMd">Link didn&apos;t work</ThemedText>
                <UIText variant="body" color="inkSecondary">
                  {message}
                </UIText>
                <Button label="Back to sign in" onPress={() => router.replace('/(auth)')} size="lg" block style={styles.button} />
              </>
            )}
          </Card>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24 },
  card: { paddingVertical: 24, gap: 12 },
  center: { textAlign: 'center' },
  input: {
    fontFamily: Type.body.fontFamily,
    fontSize: Type.body.fontSize,
    borderRadius: Radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
  },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: Radius.sm, padding: 12 },
  bannerText: { flex: 1 },
  button: { marginTop: 4 },
});
