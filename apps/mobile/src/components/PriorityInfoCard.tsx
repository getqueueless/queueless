import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Static, read-only explainer — deliberately has no toggle, switch, or writable state of any
 * kind. Only staff can mark someone senior/pregnant (`verify_priority`, a staff-only RPC), by
 * scanning or typing the token code shown above this card. Patients cannot self-report here.
 */
export function PriorityInfoCard() {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.hairline },
        CardShadow,
      ]}>
      <View style={[styles.accent, { backgroundColor: theme.primary }]} />
      <ThemedText type="headingSm">Senior citizen or pregnant?</ThemedText>
      <ThemedText type="bodySm" themeColor="inkSecondary" style={styles.body}>
        Show this screen to any staff member. Once they scan or type the code above to verify
        you, you get a 15-minute arrival-time head start in the queue.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: Rounded.xl,
    padding: Spacing.md,
    gap: Spacing.xxs,
  },
  accent: { width: 28, height: 4, borderRadius: Rounded.pill, marginBottom: Spacing.xxs },
  body: { marginTop: Spacing.xxs },
});
