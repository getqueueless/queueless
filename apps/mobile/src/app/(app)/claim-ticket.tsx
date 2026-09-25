import { errorInfo } from '@queueless/db';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useRequireCompleteProfile } from '@/lib/use-require-complete-profile';

type ClaimResult = {
  token: { id: string; service_id: string } | null;
  error_code: string | null;
  retry_after: number | null;
};

function claimErrorMessage(errorCode: string, retryAfter: number | null): string {
  if (errorCode === 'too_many_attempts' && retryAfter) {
    return `Too many failed attempts — try again in ${Math.ceil(retryAfter / 60)} minutes.`;
  }
  return errorInfo(errorCode).message;
}

// QR scanning needs `NSCameraUsageDescription` in app.json's ios.infoPlist (owned by the other
// mobile engineer — see docs/DECISIONS.md) or Expo crashes the whole app the moment the camera
// opens on iOS. Android's permission comes from expo-camera's own bundled manifest, no app.json
// change needed, so the scan option is Android-only until that lands. Manual code entry below
// works everywhere regardless — scanning is explicitly the optional path per the task brief.
const QR_SCAN_AVAILABLE = Platform.OS === 'android';

export default function ClaimTicket() {
  const theme = useTheme();
  const router = useRouter();
  const ready = useRequireCompleteProfile();

  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitCode(rawCode: string) {
    const trimmed = rawCode.trim().toUpperCase();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('claim_offline_token', { p_token_code: trimmed }).single();

    setSubmitting(false);

    if (rpcError) {
      // A real transport/precondition failure (not_signed_in, profile_incomplete, busy,
      // network) — claim_offline_token itself never raises for "that code didn't match" (see
      // supabase/README.md's "Offline ticket claim" section).
      setError(mapSupabaseError({ code: rpcError.code, message: rpcError.message }));
      return;
    }

    const result = data as ClaimResult;
    if (result.error_code) {
      setError(claimErrorMessage(result.error_code, result.retry_after));
      return;
    }
    if (result.token) {
      router.replace({
        pathname: '/(app)/token/[id]',
        params: { id: result.token.id, serviceId: result.token.service_id },
      });
    }
  }

  async function openScanner() {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    setError(null);
    setScanning(true);
  }

  function handleScanned(scannedCode: string) {
    if (!scanning) return;
    setScanning(false);
    setCode(scannedCode);
    submitCode(scannedCode);
  }

  if (!ready) return null;

  if (scanning) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title: 'Scan ticket QR' }} />
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => handleScanned(result.data)}
        />
        <SafeAreaView edges={['bottom']} style={styles.scanFooter}>
          <Pressable
            onPress={() => setScanning(false)}
            style={[styles.cancelScanButton, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
            <ThemedText type="button">Cancel</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="canvasSoft" style={styles.container}>
      <Stack.Screen options={{ title: 'Add my paper ticket' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <ThemedView type="surface" style={[styles.card, { borderColor: theme.hairline }, CardShadow]}>
          <ThemedText type="displayMd" style={styles.centerText}>
            Add my paper ticket
          </ThemedText>
          <ThemedText type="bodyLg" themeColor="inkSecondary" style={[styles.centerText, styles.subtitle]}>
            Type the ticket number printed at the desk — it looks like OPD-014.
          </ThemedText>

          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            placeholder="OPD-014"
            placeholderTextColor={theme.inkMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.codeInput, { color: theme.ink, backgroundColor: theme.canvas, borderColor: theme.hairline }]}
          />

          {error ? (
            <ThemedText type="bodyLg" themeColor="danger" style={styles.centerText}>
              {error}
            </ThemedText>
          ) : null}

          <Pressable
            onPress={() => submitCode(code)}
            disabled={submitting || code.trim().length === 0}
            style={[
              styles.bigButton,
              { backgroundColor: theme.primary, opacity: submitting || code.trim().length === 0 ? 0.6 : 1 },
            ]}>
            {submitting ? (
              <ActivityIndicator color={theme.onPrimary} size="large" />
            ) : (
              <ThemedText type="headingLg" themeColor="onPrimary">
                Add ticket
              </ThemedText>
            )}
          </Pressable>

          {QR_SCAN_AVAILABLE ? (
            <Pressable onPress={openScanner} style={styles.scanLink}>
              <ThemedText type="button" themeColor="primaryText">
                Scan QR code instead
              </ThemedText>
            </Pressable>
          ) : null}
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
    gap: Spacing.md,
  },
  centerText: { textAlign: 'center' },
  subtitle: { marginTop: -Spacing.xs },
  codeInput: {
    borderWidth: 2,
    borderRadius: Rounded.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: 32,
    lineHeight: 40,
    textAlign: 'center',
    letterSpacing: 2,
    minHeight: 64,
  },
  bigButton: {
    borderRadius: Rounded.lg,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
  },
  scanLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  camera: { flex: 1 },
  scanFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', padding: Spacing.lg },
  cancelScanButton: {
    borderWidth: 1,
    borderRadius: Rounded.pill,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
