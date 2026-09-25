import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AUTH_REDIRECT } from '@/lib/auth-redirect';
import { mapAuthError } from '@/lib/errors';
import { signInWithGoogle } from '@/lib/google-auth';
import { routeAfterAuth } from '@/lib/route-after-auth';
import { supabase } from '@/lib/supabase';

// One sign-in screen for every role, same shape as the web login: email + password first,
// Google, an emailed code as the passwordless path, and account creation verified by a 6-digit
// code. Role routing happens after sign-in (routeAfterAuth + the tabs layout), never here.
//
// Every email this screen triggers carries AUTH_REDIRECT, so a link in it (GoTrue sends a link
// instead of a code for some templates) opens the app at auth/callback when tapped on the phone.

type Mode = 'password' | 'code' | 'signup' | 'forgot';

const CODE_LENGTH = 6;
const MIN_PASSWORD = 8;
// Measured against GoTrue (2026-09-25): a second send inside ~59s is over_email_send_rate_limit.
const RESEND_COOLDOWN_SECONDS = 65;

function isPlausibleEmail(value: string): boolean {
  return /^\S+@\S+\.\S+$/.test(value.trim());
}

export default function SignIn() {
  const theme = useTheme();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('password');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const inputRefs = useRef<(TextInput | null)[]>([]);
  const trimmedEmail = email.trim();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function switchMode(next: Mode) {
    setMode(next);
    setAwaitingCode(false);
    setError(null);
    setNotice(null);
    setDigits(Array(CODE_LENGTH).fill(''));
  }

  function authError(e: { code?: string; message?: string }) {
    setError(mapAuthError({ code: e.code, message: e.message }));
  }

  async function handlePasswordSignIn() {
    setError(null);
    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
    setBusy(false);
    if (signInError) return authError(signInError);
    await routeAfterAuth(router);
  }

  async function sendSignInCode() {
    setError(null);
    setBusy(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: { shouldCreateUser: true, emailRedirectTo: AUTH_REDIRECT },
    });
    setBusy(false);
    if (sendError) return authError(sendError);
    setAwaitingCode(true);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function createAccount() {
    if (password.length < MIN_PASSWORD) return setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
    setError(null);
    setBusy(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: { emailRedirectTo: AUTH_REDIRECT },
    });
    setBusy(false);
    if (signUpError) return authError(signUpError);
    // GoTrue answers an already-registered address with a user that has no identities and
    // sends nothing, so it doesn't leak who has an account. Say so instead of waiting forever.
    if (data.user && data.user.identities?.length === 0) {
      return setError('An account with this email already exists. Sign in instead.');
    }
    setAwaitingCode(true);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function sendReset() {
    setError(null);
    setBusy(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, { redirectTo: AUTH_REDIRECT });
    setBusy(false);
    if (resetError) return authError(resetError);
    setNotice(`If ${trimmedEmail} has an account, we emailed a reset link. Open it on this phone to choose a new password.`);
  }

  async function resend() {
    if (cooldown > 0 || busy) return;
    setError(null);
    setBusy(true);
    const { error: sendError } =
      mode === 'signup'
        ? await supabase.auth.resend({ type: 'signup', email: trimmedEmail, options: { emailRedirectTo: AUTH_REDIRECT } })
        : await supabase.auth.signInWithOtp({ email: trimmedEmail, options: { shouldCreateUser: true, emailRedirectTo: AUTH_REDIRECT } });
    setBusy(false);
    if (sendError) return authError(sendError);
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  function clearCode() {
    setDigits(Array(CODE_LENGTH).fill(''));
    inputRefs.current[0]?.focus();
  }

  async function verify(code: string) {
    setError(null);
    setVerifying(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: trimmedEmail,
      token: code,
      type: mode === 'signup' ? 'signup' : 'email',
    });
    setVerifying(false);
    if (verifyError) {
      authError(verifyError);
      clearCode();
      return;
    }
    await routeAfterAuth(router);
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
    await routeAfterAuth(router);
  }

  function handleDigitChange(index: number, value: string) {
    const numeric = value.replace(/\D/g, '');

    if (numeric.length > 1) {
      // A paste (or iOS one-time-code autofill) delivers the whole code as one change event.
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

  const inputStyle = [styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }];

  const emailInput = (
    <TextInput
      value={email}
      onChangeText={setEmail}
      placeholder="Email"
      placeholderTextColor={theme.inkMuted}
      autoCapitalize="none"
      autoComplete="email"
      textContentType="emailAddress"
      keyboardType="email-address"
      accessibilityLabel="Email"
      style={inputStyle}
    />
  );

  const errorText = error ? (
    <ThemedText type="bodySm" themeColor="danger" style={styles.error} accessibilityLiveRegion="polite">
      {error}
    </ThemedText>
  ) : null;

  function primaryButton(label: string, onPress: () => void, disabled: boolean) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: theme.primary, opacity: disabled || busy ? 0.6 : 1 }]}>
        {busy ? (
          <ActivityIndicator color={theme.onPrimary} />
        ) : (
          <ThemedText type="button" themeColor="onPrimary">
            {label}
          </ThemedText>
        )}
      </Pressable>
    );
  }

  function link(label: string, onPress: () => void, style: StyleProp<ViewStyle> = styles.link) {
    return (
      <Pressable onPress={onPress} accessibilityRole="link" hitSlop={4} style={style}>
        <ThemedText type="bodySm" themeColor="primaryText">
          {label}
        </ThemedText>
      </Pressable>
    );
  }

  function screen(children: ReactNode) {
    return (
      <ThemedView type="canvasSoft" style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedView type="surface" style={[styles.card, { borderColor: theme.hairline }]}>
            {children}
          </ThemedView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (awaitingCode) {
    return screen(
      <>
        <ThemedText type="displayMd">Enter your code</ThemedText>
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          We sent a 6-digit code to {trimmedEmail}. If the email has a link instead, tap it on this phone.
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
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              accessibilityLabel={`Digit ${i + 1} of ${CODE_LENGTH}`}
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
        {errorText}

        <Pressable
          onPress={() => verify(digits.join(''))}
          disabled={verifying || digits.some((d) => !d)}
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: theme.primary, opacity: verifying ? 0.6 : 1 }]}>
          <ThemedText type="button" themeColor="onPrimary">
            Verify
          </ThemedText>
        </Pressable>

        <Pressable onPress={resend} disabled={cooldown > 0 || busy} accessibilityRole="button" style={styles.link}>
          <ThemedText type="bodySm" themeColor={cooldown > 0 ? 'inkMuted' : 'primaryText'}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </ThemedText>
        </Pressable>
        {link('Wrong email?', () => {
          setAwaitingCode(false);
          setCooldown(0);
          setError(null);
          setDigits(Array(CODE_LENGTH).fill(''));
        })}
      </>,
    );
  }

  if (mode === 'code') {
    return screen(
      <>
        <ThemedText type="displayMd">Sign in with a code</ThemedText>
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          We&apos;ll email you a 6-digit code — no password needed.
        </ThemedText>
        {emailInput}
        {errorText}
        {primaryButton('Send code', sendSignInCode, !isPlausibleEmail(email))}
        {link('Use my password instead', () => switchMode('password'))}
      </>,
    );
  }

  if (mode === 'forgot') {
    return screen(
      <>
        <ThemedText type="displayMd">Reset your password</ThemedText>
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          Enter your email and we&apos;ll send you a link to choose a new password.
        </ThemedText>
        {emailInput}
        {errorText}
        {notice ? (
          <ThemedText type="bodySm" themeColor="success" accessibilityLiveRegion="polite">
            {notice}
          </ThemedText>
        ) : null}
        {primaryButton('Send reset link', sendReset, !isPlausibleEmail(email))}
        {link('Back to sign in', () => switchMode('password'))}
      </>,
    );
  }

  if (mode === 'signup') {
    return screen(
      <>
        <ThemedText type="displayMd">Create your account</ThemedText>
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          We&apos;ll email you a 6-digit code to confirm it&apos;s you.
        </ThemedText>
        {emailInput}
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={`Password (${MIN_PASSWORD}+ characters)`}
          placeholderTextColor={theme.inkMuted}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          accessibilityLabel="Password"
          style={inputStyle}
        />
        {errorText}
        {primaryButton('Create account', createAccount, !isPlausibleEmail(email) || !password)}
        <View style={styles.footerRow}>
          <ThemedText type="bodySm" themeColor="inkMuted">
            Already have an account?
          </ThemedText>
          {link('Sign in', () => switchMode('password'), styles.inlineLink)}
        </View>
      </>,
    );
  }

  return screen(
    <>
      <ThemedText type="displayMd">Welcome</ThemedText>
      <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
        Sign in to Queueless.
      </ThemedText>

      {emailInput}
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={theme.inkMuted}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        accessibilityLabel="Password"
        onSubmitEditing={() => isPlausibleEmail(email) && password && handlePasswordSignIn()}
        style={inputStyle}
      />
      {link('Forgot password?', () => switchMode('forgot'), styles.forgotLink)}

      {errorText}
      {primaryButton('Sign in', handlePasswordSignIn, !isPlausibleEmail(email) || !password)}

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
        accessibilityRole="button"
        style={[styles.googleButton, { borderColor: theme.hairline, opacity: googleLoading ? 0.6 : 1 }]}>
        {googleLoading ? (
          <ActivityIndicator color={theme.ink} />
        ) : (
          <ThemedText type="button" themeColor="ink">
            Continue with Google
          </ThemedText>
        )}
      </Pressable>

      {link('Email me a sign-in code instead', () => switchMode('code'))}

      <View style={[styles.footerRow, styles.footerDivider, { borderColor: theme.hairline }]}>
        <ThemedText type="bodySm" themeColor="inkMuted">
          New to Queueless?
        </ThemedText>
        {link('Create an account', () => switchMode('signup'), styles.inlineLink)}
      </View>
    </>,
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
  link: { marginTop: Spacing.xs, alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  forgotLink: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center' },
  inlineLink: { minHeight: 44, justifyContent: 'center' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.xxs, flexWrap: 'wrap' },
  footerDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.xs, paddingTop: Spacing.xs },
});
