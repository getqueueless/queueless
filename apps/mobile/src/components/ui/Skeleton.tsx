import { useEffect, useState } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

import { cssGradient } from './tokens';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * A placeholder block with a light band sweeping across while content loads. Hidden from screen
 * readers: label the loading region itself (e.g. accessibilityLabel="Loading doctors").
 * Reduce Motion keeps it a still block.
 */
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: SkeletonProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const reduceMotion = useReducedMotion();
  const [w, setW] = useState(0);
  const x = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || !w) return;
    x.set(withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }), -1, false));
    return () => cancelAnimation(x);
  }, [reduceMotion, w, x]);

  const band = useAnimatedStyle(() => ({ transform: [{ translateX: (x.get() * 2 - 1) * w }] }));
  const shine = dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.75)';

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.block, { width, height, borderRadius: radius, backgroundColor: theme.surfaceSunken }, style]}>
      {!reduceMotion && w ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, cssGradient(`linear-gradient(90deg, transparent, ${shine}, transparent)`), band]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { overflow: 'hidden' },
});
