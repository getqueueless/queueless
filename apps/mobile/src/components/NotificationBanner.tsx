import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Rounded, Spacing } from '@/constants/theme';
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
    <ThemedView style={[styles.banner, { backgroundColor: theme.primarySoft }]}>
      <Pressable style={styles.content} onPress={onPress} hitSlop={8}>
        <ThemedText type="headingSm" themeColor="primary">
          {title}
        </ThemedText>
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
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Rounded.md,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.xs,
    gap: Spacing.sm,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  close: {
    paddingHorizontal: Spacing.xxs,
  },
});
