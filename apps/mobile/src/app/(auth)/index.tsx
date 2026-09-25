import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, MIN_TAP, Radius, Type, UIText, type IconName } from '@/components/ui';
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

const GOOGLE_G = require('../../../assets/images/google-g.png');
const ERROR_ICON: IconName = { ios: 'exclamationmark.circle.fill', android: 'error', web: 'error' };
const OK_ICON: IconName = { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' };

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
    setCooldown(RESEND_COOLDOWN_SECONDS);
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
    if (verifyError) {
      setVerifying(false);
      authError(verifyError);
      clearCode();
      return;
    }
    if (mode === 'signup') {
      // GoTrue keeps the old password when the address already existed unconfirmed (an unused
      // email code, or an abandoned first sign-up), so set the one typed here explicitly.
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError && pwError.code !== 'same_password') {
        setVerifying(false);
        return authError(pwError);
      }
    }
    setVerifying(false);
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

  // A danger border on the fields while an error shows; what was typed is never cleared.
  const inputStyle = [
    styles.input,
    {
      color: theme.ink,
      backgroundColor: theme.surfaceSunken,
      borderColor: error ? theme.danger : theme.hairlineStrong,
      borderWidth: error ? 2 : 1,
    },
  ];

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

  function banner(tone: 'danger' | 'success', text: string) {
    return (
      <View
        accessibilityRole={tone === 'danger' ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={[
          styles.banner,
          { backgroundColor: tone === 'danger' ? theme.dangerSoft : theme.successSoft, borderColor: theme[tone] },
        ]}>
        <SymbolView name={tone === 'danger' ? ERROR_ICON : OK_ICON} size={22} tintColor={theme[tone]} />
        <UIText variant="secondaryStrong" color={tone} style={styles.bannerText}>
          {text}
        </UIText>
      </View>
    );
  }

  const errorText = error ? banner('danger', error) : null;

  function primaryButton(label: string, onPress: () => void, disabled: boolean) {
    return <Button label={label} onPress={onPress} size="lg" block loading={busy} disabled={disabled} style={styles.button} />;
  }

  function link(label: string, onPress: () => void, style: StyleProp<ViewStyle> = styles.link) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        style={({ pressed }) => [styles.linkBase, style, pressed && styles.pressed]}>
        <UIText variant="secondaryStrong" color="primaryText">
          {label}
        </UIText>
      </Pressable>
    );
  }

  function screen(children: ReactNode) {
    return (
      <ThemedView type="canvasSoft" style={styles.container}>
        <SafeAreaView style={styles.container}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Card style={styles.card}>{children}</Card>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (awaitingCode) {
    return screen(
      <>
        <ThemedText type="displayMd">Enter your code</ThemedText>
        <UIText variant="body" color="inkSecondary" style={styles.subtitle}>
          We sent a 6-digit code to {trimmedEmail}. If the email has a link instead, tap it on this phone.
        </UIText>

        <View style={styles.codeRow}>
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
                  backgroundColor: digit ? theme.primarySoft : theme.surfaceSunken,
                  borderColor: digit ? theme.primaryOutline : error ? theme.danger : theme.hairlineStrong,
                  borderWidth: digit || error ? 2 : 1,
                },
              ]}
            />
          ))}
        </View>

        {errorText}

        <Button
          label="Verify"
          onPress={() => verify(digits.join(''))}
          size="lg"
          block
          loading={verifying}
          disabled={digits.some((d) => !d)}
          style={styles.button}
        />

        <Pressable
          onPress={resend}
          disabled={cooldown > 0 || busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.linkBase, styles.link, pressed && styles.pressed]}>
          <UIText variant="secondaryStrong" color={cooldown > 0 ? 'inkSecondary' : 'primaryText'}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </UIText>
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
        <UIText variant="body" color="inkSecondary" style={styles.subtitle}>
          We&apos;ll email you a 6-digit code — no password needed.
        </UIText>
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
        <UIText variant="body" color="inkSecondary" style={styles.subtitle}>
          Enter your email and we&apos;ll send you a link to choose a new password.
        </UIText>
        {emailInput}
        {errorText}
        {notice ? banner('success', notice) : null}
        {primaryButton(cooldown > 0 ? `Send again in ${cooldown}s` : 'Send reset link', sendReset, !isPlausibleEmail(email) || cooldown > 0)}
        {link('Back to sign in', () => switchMode('password'))}
      </>,
    );
  }

  if (mode === 'signup') {
    return screen(
      <>
        <ThemedText type="displayMd">Create your account</ThemedText>
        <UIText variant="body" color="inkSecondary" style={styles.subtitle}>
          We&apos;ll email you a 6-digit code to confirm it&apos;s you.
        </UIText>
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
        <View style={[styles.footerRow, styles.footerDivider, { borderColor: theme.hairline }]}>
          <UIText variant="secondary" color="inkSecondary">
            Already have an account?
          </UIText>
          {link('Sign in', () => switchMode('password'))}
        </View>
      </>,
    );
  }

  return screen(
    <>
      <ThemedText type="displayMd">Welcome</ThemedText>
      <UIText variant="body" color="inkSecondary" style={styles.subtitle}>
        Sign in to Queueless.
      </UIText>

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

      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
        <UIText variant="secondary" color="inkSecondary">
          or
        </UIText>
        <View style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
      </View>

      {/* Google's branding asks for a neutral button with the logo unaltered. */}
      <Pressable
        onPress={handleGoogleSignIn}
        disabled={googleLoading}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        accessibilityState={{ disabled: googleLoading, busy: googleLoading }}
        style={({ pressed }) => [
          styles.googleButton,
          { backgroundColor: theme.surface, borderColor: theme.hairlineStrong, opacity: googleLoading ? 0.6 : 1 },
          pressed && styles.pressed,
        ]}>
        {googleLoading ? (
          <ActivityIndicator color={theme.ink} />
        ) : (
          <>
            <Image source={GOOGLE_G} style={styles.googleLogo} accessibilityIgnoresInvertColors />
            <UIText variant="bodyStrong">Continue with Google</UIText>
          </>
        )}
      </Pressable>

      {link('Email me a sign-in code instead', () => switchMode('code'))}

      <View style={[styles.footerRow, styles.footerDivider, { borderColor: theme.hairline }]}>
        <UIText variant="secondary" color="inkSecondary">
          New to Queueless?
        </UIText>
        {link('Create an account', () => switchMode('signup'))}
      </View>
    </>,
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // 16pt gutter + 16pt card padding leaves room for six 48pt code boxes on a 360pt phone.
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 24 },
  card: { paddingVertical: 24, gap: 12 },
  subtitle: { marginBottom: 4 },
  input: {
    fontFamily: Type.body.fontFamily,
    fontSize: Type.body.fontSize,
    borderRadius: Radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
  },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  codeBox: {
    width: MIN_TAP,
    height: 56,
    borderRadius: Radius.sm,
    textAlign: 'center',
    fontFamily: Type.title3.fontFamily,
    fontSize: Type.title3.fontSize,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: 12,
  },
  bannerText: { flex: 1 },
  button: { marginTop: 4 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: 56,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 24,
  },
  googleLogo: { width: 20, height: 20 },
  linkBase: { minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  link: { alignSelf: 'center' },
  forgotLink: { alignSelf: 'flex-end', marginTop: -4 },
  pressed: { opacity: 0.7 },
  footerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' },
  footerDivider: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
});
