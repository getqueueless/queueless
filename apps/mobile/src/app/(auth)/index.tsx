import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapAuthError } from '@/lib/errors';
import { signInWithGoogle } from '@/lib/google-auth';
import { supabase } from '@/lib/supabase';

const CODE_LENGTH = 6;
// Measured empirically against the real local GoTrue instance (2026-09-25): a second send to
// the same address inside ~59s comes back `over_email_send_rate_limit`. 65s keeps this button
// comfortably behind that window instead of racing it — see docs/DECISIONS.md.
const RESEND_COOLDOWN_SECONDS = 65;

function isPlausibleEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim());
}

export default function Otp() {
  const theme = useTheme();
  const router = useRouter();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [googleLoading, setGoogleLoading] = useState(false);

  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Countdown ticks in state via setInterval rather than comparing against a stored
  // send-timestamp on every render — simplest thing that's correct for a 60s window.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function sendCode() {
    setError(null);
    setSending(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setSending(false);
    if (sendError) {
      setError(mapAuthError({ code: sendError.code, message: sendError.message }));
      return;
    }
    setStep('code');
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function resend() {
    if (cooldown > 0 || sending) return;
    setError(null);
    setSending(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setSending(false);
    if (sendError) {
      setError(mapAuthError({ code: sendError.code, message: sendError.message }));
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  function clearCode() {
    setDigits(Array(CODE_LENGTH).fill(''));
    inputRefs.current[0]?.focus();
  }

  function backToEmail() {
    setStep('email');
    setError(null);
    setCooldown(0);
    clearCode();
  }

  // Session now exists (auth.onAuthStateChange already fired) — decide where to land next.
  // Calling this explicitly rather than only relying on (auth)/_layout's own session redirect
  // covers the first-login name screen; the two can race by a frame (see docs/DECISIONS.md),
  // worst case a one-frame flash of the tab bar before landing on name-entry, never a wrong
  // final screen. Shared by OTP verify and Google sign-in — same decision either way. Google
  // sign-ins typically arrive with `full_name` already set (GoTrue copies it from the provider
  // into `raw_user_meta_data`, and the signup trigger copies that into `profiles`), so most
  // Google sign-ins skip name-entry entirely without any extra code here.
  async function routeAfterAuth() {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (userId) {
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
      if (!profile?.full_name) {
        router.replace('/(app)/name-entry');
        return;
      }
    }
    router.replace('/(app)/(tabs)');
  }

  async function verify(code: string) {
    setError(null);
    setVerifying(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    setVerifying(false);
    if (verifyError) {
      setError(mapAuthError({ code: verifyError.code, message: verifyError.message }));
      clearCode();
      return;
    }
    await routeAfterAuth();
  }

  async function handleGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);
    const result = await signInWithGoogle();
    setGoogleLoading(false);
    if (!result.ok) {
      if (!result.cancelled) setError(result.message);
      return;
    }
    await routeAfterAuth();
  }

  function handleDigitChange(index: number, value: string) {
    const numeric = value.replace(/\D/g, '');

    if (numeric.length > 1) {
      // A paste delivers the whole code as one change event on whichever box has focus.
      const pasted = numeric.slice(0, CODE_LENGTH).split('');
      const next = Array(CODE_LENGTH).fill('');
      pasted.forEach((d, i) => {
        next[i] = d;
      });
      setDigits(next);
      if (pasted.length === CODE_LENGTH) {
        inputRefs.current[CODE_LENGTH - 1]?.blur();
        verify(pasted.join(''));
      } else {
        inputRefs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
      }
      return;
    }

    const next = [...digits];
    next[index] = numeric;
    setDigits(next);

    if (numeric && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    if (next.every((d) => d.length === 1)) {
      inputRefs.current[index]?.blur();
      verify(next.join(''));
    }
  }

  function handleKeyPress(index: number, key: string) {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  if (step === 'email') {
    return (
      <ThemedView type="canvasSoft" style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedView type="surface" style={[styles.card, { borderColor: theme.hairline }]}>
            <ThemedText type="displayMd">Welcome</ThemedText>
            <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
              We&apos;ll email you a 6-digit code — no password to remember.
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

            {error ? (
              <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
                {error}
              </ThemedText>
            ) : null}

            <Pressable
              onPress={sendCode}
              disabled={sending || !isPlausibleEmail(email)}
              style={[styles.button, { backgroundColor: theme.primary, opacity: sending ? 0.6 : 1 }]}>
              {sending ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <ThemedText type="button" themeColor="onPrimary">
                  Send code
                </ThemedText>
              )}
            </Pressable>

            <ThemedView style={styles.dividerRow}>
              <ThemedView style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
              <ThemedText type="bodySm" themeColor="inkMuted">
                or
              </ThemedText>
              <ThemedView style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
            </ThemedView>

            <Pressable
              onPress={handleGoogleSignIn}
              disabled={googleLoading}
              style={[styles.googleButton, { borderColor: theme.hairline, opacity: googleLoading ? 0.6 : 1 }]}>
              {googleLoading ? (
                <ActivityIndicator color={theme.ink} />
              ) : (
                <ThemedText type="button" themeColor="ink">
                  Continue with Google
                </ThemedText>
              )}
            </Pressable>

            <Pressable onPress={() => router.push('/(auth)/password-fallback')} style={styles.link}>
              <ThemedText type="bodySm" themeColor="inkMuted">
                Having trouble? Use password sign-in instead
              </ThemedText>
            </Pressable>
          </ThemedView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="canvasSoft" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView type="surface" style={[styles.card, { borderColor: theme.hairline }]}>
          <ThemedText type="displayMd">Enter your code</ThemedText>
          <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
            We sent a 6-digit code to {email}.
          </ThemedText>

          <ThemedView style={styles.codeRow}>
            {digits.map((digit, i) => (
              <TextInput
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                value={digit}
                onChangeText={(value) => handleDigitChange(i, value)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
                keyboardType="number-pad"
                maxLength={i === 0 ? CODE_LENGTH : 1}
                textContentType="oneTimeCode"
                editable={!verifying}
                style={[
                  styles.codeBox,
                  {
                    color: theme.ink,
                    backgroundColor: digit ? theme.primarySoft : theme.canvas,
                    borderColor: digit ? theme.primaryOutline : theme.hairline,
                    borderWidth: digit ? 2 : 1,
                  },
                ]}
              />
            ))}
          </ThemedView>

          {verifying ? <ActivityIndicator color={theme.primary} style={styles.verifyingSpinner} /> : null}

          {error ? (
            <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          <Pressable
            onPress={() => verify(digits.join(''))}
            disabled={verifying || digits.some((d) => !d)}
            style={[styles.button, { backgroundColor: theme.primary, opacity: verifying ? 0.6 : 1 }]}>
            <ThemedText type="button" themeColor="onPrimary">
              Verify
            </ThemedText>
          </Pressable>

          <Pressable onPress={resend} disabled={cooldown > 0 || sending} style={styles.link}>
            <ThemedText type="bodySm" themeColor={cooldown > 0 ? 'inkMuted' : 'primaryText'}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </ThemedText>
          </Pressable>

          <Pressable onPress={backToEmail} style={styles.link}>
            <ThemedText type="bodySm" themeColor="inkMuted">
              Wrong email?
            </ThemedText>
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
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: 'transparent' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
    backgroundColor: 'transparent',
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  googleButton: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  codeBox: {
    width: 44,
    height: 52,
    borderRadius: Rounded.md,
    textAlign: 'center',
    fontSize: 22,
  },
  verifyingSpinner: { marginTop: Spacing.xs },
  error: { marginTop: Spacing.xxs },
  button: {
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
    minHeight: 44,
  },
  link: { marginTop: Spacing.md, alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
});
