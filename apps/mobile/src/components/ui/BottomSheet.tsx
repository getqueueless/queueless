import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

import { Radius } from './tokens';

const EASE_MS = 220;

/**
 * A slide-up sheet for the Doctors tab's detail view -- plain `Modal` + Reanimated (both already
 * dependencies) rather than adding @gorhom/bottom-sheet for one screen's use of it.
 */
export function BottomSheet({
  visible,
  onClose,
  children,
  maxHeight,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: number | `${number}%`;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(reduceMotion ? (visible ? 1 : 0) : withTiming(visible ? 1 : 0, { duration: EASE_MS }));
  }, [visible, reduceMotion, progress]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * 400 }],
    opacity: progress.get(),
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() * 0.5 }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: theme.surface, maxHeight: maxHeight ?? '85%' } as ViewStyle,
          sheetStyle,
        ]}>
        <View style={[styles.grabber, { backgroundColor: theme.hairlineStrong }]} />
        <SafeAreaView edges={['bottom']} style={styles.content}>
          {children}
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingTop: 12,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
});
