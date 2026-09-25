import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type NotificationBannerProps = {
  visible: boolean;
  title: string;
  body: string;
  onPress: () => void;
  onDismiss: () => void;
};

/** Dismissible in-app banner for the Realtime notifications path — the reliable mechanism. */
export function NotificationBanner({ visible, title, body, onPress, onDismiss }: NotificationBannerProps) {
  const theme = useTheme();

  if (!visible) return null;

  return (
    <ThemedView style={[styles.banner, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
      <Pressable style={styles.content} onPress={onPress} hitSlop={8}>
        <ThemedText type="headingSm">{title}</ThemedText>
        <ThemedText type="bodySm" themeColor="inkSecondary">
          {body}
        </ThemedText>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={12} style={styles.close}>
        <ThemedText type="button" themeColor="inkMuted">
          ✕
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Rounded.lg,
    borderWidth: 1,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.xs,
    gap: Spacing.sm,
    ...CardShadow,
  },
  content: {
    flex: 1,
    gap: Spacing.xxs,
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
