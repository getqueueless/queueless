import { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { CardShadow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getToast, subscribeToast } from '@/lib/toast-store';

import { Radius } from './tokens';
import { UIText } from './UIText';

/**
 * One place, mounted once in (app)/_layout.tsx alongside NotificationBanner/OfflineBanner --
 * any screen calls `showToast()` from lib/toast-store.ts, nothing renders this itself.
 */
export function Toast() {
  const theme = useTheme();
  const toast = useSyncExternalStore(subscribeToast, getToast, () => null);

  // AccessibilityInfo announces the message once per toast, same pattern QueueTracker uses for
  // its own stage changes.
  useEffect(() => {
    if (!toast) return;
    import('react-native').then(({ AccessibilityInfo }) => AccessibilityInfo.announceForAccessibility(toast.message));
  }, [toast]);

  if (!toast) return null;

  const toneColor = toast.tone === 'success' ? theme.success : toast.tone === 'error' ? theme.danger : theme.ink;

  return (
    <Animated.View
      key={toast.id}
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(180)}
      pointerEvents="none"
      style={[styles.wrap, { backgroundColor: theme.surface, borderColor: theme.hairline }, CardShadow]}>
      <UIText variant="secondaryStrong" style={[styles.text, { color: toneColor }]}>
        {toast.message}
      </UIText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 50,
  },
  text: { textAlign: 'center' },
});
