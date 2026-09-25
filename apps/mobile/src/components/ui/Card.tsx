import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { CardShadow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AnimatedPressable, usePressScale } from './press';
import { Radius } from './tokens';

export type CardProps = {
  children: ReactNode;
  /**
   * Makes the whole card one tap target that shrinks to 0.98 while pressed. Don't also put a
   * button inside a pressable card: nested tap targets hide the inner one from screen readers.
   */
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

/** Surface card: white (or dark surface), hairline border, soft MedWin shadow, 20 radius. */
export function Card({ children, onPress, accessibilityLabel, style }: CardProps) {
  const theme = useTheme();
  const press = usePressScale(0.98);
  const look = [styles.card, CardShadow, { backgroundColor: theme.surface, borderColor: theme.hairline }, style];

  if (!onPress) return <View style={look}>{children}</View>;
  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[look, press.style]}>
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: 16, gap: 12, minHeight: 48 },
});
