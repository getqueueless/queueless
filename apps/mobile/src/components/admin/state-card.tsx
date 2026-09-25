import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Shared loading/error/empty placeholder — same shape as Home's inline `stateCard` (see
 * `(tabs)/index.tsx`), pulled out here because all three admin screens (dashboard, services,
 * counters) need it for their lists.
 */
export function StateCard({ kind, message }: { kind: 'loading' | 'error' | 'empty'; message?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, CardShadow, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      {kind === 'loading' ? (
        <ActivityIndicator color={theme.primary} />
      ) : (
        <ThemedText type="body" themeColor={kind === 'error' ? 'danger' : 'inkMuted'} style={styles.text}>
          {message}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { textAlign: 'center' },
});
