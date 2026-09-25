import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Pressable } from 'react-native';

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Press-in shrink for tappable surfaces; Reduce Motion keeps them still. */
export function usePressScale(to: number) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return {
    style,
    onPressIn: () => {
      if (!reduceMotion) scale.set(withTiming(to, { duration: 90 }));
    },
    onPressOut: () => {
      if (!reduceMotion) scale.set(withSpring(1, { damping: 15, stiffness: 320 }));
    },
  };
}
