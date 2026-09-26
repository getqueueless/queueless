import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';

// queueless://paid/<holdId> is where Razorpay's page sends the phone back (lib/paid-booking.ts).
// expo-router routes every incoming deep link, so without this file the return showed "Unmatched
// route" over the checkout. The checkout screen underneath already listens for this URL and
// re-reads the real payment status from the server; this screen just steps back to it, or opens
// it on a cold start. Nothing here trusts the URL.
export default function PaidReturn() {
  const theme = useTheme();
  const router = useRouter();
  const { holdId } = useLocalSearchParams<{ holdId?: string }>();

  useEffect(() => {
    if (router.canGoBack()) router.back();
    else if (holdId) router.replace({ pathname: '/(app)/checkout/[holdId]', params: { holdId } });
    else router.replace('/(app)/(tabs)');
  }, [router, holdId]);

  return (
    <ThemedView type="canvas" style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={theme.primary} />
    </ThemedView>
  );
}
