import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useNetworkStatus } from '@/lib/use-network-status';

/** Slim top banner shown only while offline; disappears the instant NetInfo reports reconnect. */
export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();
  const theme = useTheme();

  if (isConnected) return null;

  return (
    <ThemedView style={[styles.banner, { backgroundColor: theme.warningSoft, borderColor: theme.warning }]}>
      <ThemedText type="caption" themeColor="warning">
        You&apos;re offline — showing the last known status.
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: Spacing.xxs,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    alignItems: 'center',
  },
});
