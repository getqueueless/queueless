import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Gender = 'female' | 'male' | 'other' | 'prefer_not';

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not', label: 'Prefer not to say' },
];

function onlyDigits(value: string, max: number): string {
  return value.replace(/\D/g, '').slice(0, max);
}

/** `d`/`m`/`y` are the raw digit strings from the three DOB boxes. */
function toIsoDate(d: string, m: string, y: string): string | null {
  if (d.length === 0 || m.length === 0 || y.length !== 4) return null;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  // Reject an impossible calendar date (e.g. 31 Feb) instead of letting JS Date silently roll it
  // over into the next month — the server re-validates anyway, but a bad date here should never
  // even reach it.
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const PHONE_PATTERN = /^[6-9][0-9]{9}$/;

/**
 * Mandatory, one-time screen after first login: `complete_my_profile` requires all of these
 * before `issue_token`/`book_appointment`/`claim_offline_token` will run (see
 * supabase/migrations/0037_mandatory_profile.sql). Kept at this route path
 * (`(app)/name-entry`) rather than renamed, since `(auth)/index.tsx`'s post-login redirect
 * points here — see docs/DECISIONS.md.
 */
export default function CompleteProfile() {
  const theme = useTheme();
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [city, setCity] = useState('');
  const [addressLine, setAddressLine] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dob = toIsoDate(day, month, year);
  const phoneValid = PHONE_PATTERN.test(phone);
  const canSubmit = fullName.trim().length > 0 && phoneValid && !!dob && !!gender && city.trim().length > 0;

  async function handleContinue() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('complete_my_profile', {
      p_full_name: fullName.trim(),
      p_phone: `+91${phone}`,
      p_date_of_birth: dob,
      p_gender: gender,
      p_city: city.trim(),
      p_address_line: addressLine.trim() || null,
    });

    setSubmitting(false);
    if (rpcError) {
      setError(mapSupabaseError({ code: rpcError.code, message: rpcError.message }));
      return;
    }
    router.replace('/(app)/(tabs)');
  }

  return (
    <ThemedView type="canvasSoft" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <ThemedView type="surface" style={[styles.card, { borderColor: theme.hairline }, CardShadow]}>
            <ThemedText type="displayMd">Complete your profile</ThemedText>
            <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
              We need a few details before you can take a token or book an appointment.
            </ThemedText>

            <ThemedText type="headingSm" style={styles.label}>
              Full name
            </ThemedText>
            <TextInput
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your full name"
              placeholderTextColor={theme.inkMuted}
              autoCapitalize="words"
              style={[styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
            />

            <ThemedText type="headingSm" style={styles.label}>
              Phone number
            </ThemedText>
            <View style={styles.phoneRow}>
              <View style={[styles.phonePrefix, { borderColor: theme.hairline, backgroundColor: theme.surfaceSunken }]}>
                <ThemedText type="bodyLg">+91</ThemedText>
              </View>
              <TextInput
                value={phone}
                onChangeText={(v) => setPhone(onlyDigits(v, 10))}
                placeholder="10-digit mobile number"
                placeholderTextColor={theme.inkMuted}
                keyboardType="number-pad"
                maxLength={10}
                style={[
                  styles.input,
                  styles.phoneInput,
                  { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline },
                ]}
              />
            </View>

            <ThemedText type="headingSm" style={styles.label}>
              Date of birth
            </ThemedText>
            <View style={styles.dobRow}>
              <TextInput
                value={day}
                onChangeText={(v) => setDay(onlyDigits(v, 2))}
                placeholder="DD"
                placeholderTextColor={theme.inkMuted}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.input, styles.dobBox, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
              />
              <TextInput
                value={month}
                onChangeText={(v) => setMonth(onlyDigits(v, 2))}
                placeholder="MM"
                placeholderTextColor={theme.inkMuted}
                keyboardType="number-pad"
                maxLength={2}
                style={[styles.input, styles.dobBox, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
              />
              <TextInput
                value={year}
                onChangeText={(v) => setYear(onlyDigits(v, 4))}
                placeholder="YYYY"
                placeholderTextColor={theme.inkMuted}
                keyboardType="number-pad"
                maxLength={4}
                style={[styles.input, styles.dobBoxYear, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
              />
            </View>

            <ThemedText type="headingSm" style={styles.label}>
              Gender
            </ThemedText>
            <View style={styles.pillRow}>
              {GENDER_OPTIONS.map((opt) => {
                const selected = gender === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setGender(opt.value)}
                    style={[
                      styles.pill,
                      {
                        backgroundColor: selected ? theme.primarySoft : theme.canvas,
                        borderColor: selected ? theme.primaryOutline : theme.hairline,
                        borderWidth: selected ? 2 : 1,
                      },
                    ]}>
                    <ThemedText type="bodySm" themeColor={selected ? 'primaryText' : 'inkSecondary'}>
                      {opt.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            <ThemedText type="headingSm" style={styles.label}>
              City
            </ThemedText>
            <TextInput
              value={city}
              onChangeText={setCity}
              placeholder="Your city"
              placeholderTextColor={theme.inkMuted}
              autoCapitalize="words"
              style={[styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
            />

            <ThemedText type="headingSm" style={styles.label}>
              Address (optional)
            </ThemedText>
            <TextInput
              value={addressLine}
              onChangeText={setAddressLine}
              placeholder="House / street / area"
              placeholderTextColor={theme.inkMuted}
              style={[styles.input, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
            />

            {error ? (
              <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
                {error}
              </ThemedText>
            ) : null}

            <Pressable
              onPress={handleContinue}
              disabled={submitting || !canSubmit}
              style={[
                styles.button,
                { backgroundColor: theme.primary, opacity: submitting || !canSubmit ? 0.6 : 1 },
              ]}>
              {submitting ? (
                <ActivityIndicator color={theme.onPrimary} />
              ) : (
                <ThemedText type="button" themeColor="onPrimary">
                  Continue
                </ThemedText>
              )}
            </Pressable>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.xl,
    padding: Spacing.xl,
    gap: Spacing.xxs,
  },
  subtitle: { marginBottom: Spacing.sm },
  label: { marginTop: Spacing.md, marginBottom: Spacing.xxs },
  input: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    fontSize: 14,
    minHeight: 44,
  },
  phoneRow: { flexDirection: 'row', gap: Spacing.xs },
  phonePrefix: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneInput: { flex: 1 },
  dobRow: { flexDirection: 'row', gap: Spacing.xs },
  dobBox: { flex: 1, textAlign: 'center' },
  dobBoxYear: { flex: 1.6, textAlign: 'center' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  pill: {
    borderRadius: Rounded.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { marginTop: Spacing.md },
  button: {
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
    minHeight: 44,
  },
});
