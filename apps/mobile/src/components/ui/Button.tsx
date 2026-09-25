import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

import { AnimatedPressable, usePressScale } from './press';
import { Radius, Type, type IconName } from './tokens';
import { UIText } from './UIText';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** lg is 56 tall (main CTAs), md is 48 (the tap-target floor). */
  size?: 'lg' | 'md';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width. */
  block?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading = false,
  disabled = false,
  block = false,
  style,
  accessibilityHint,
}: ButtonProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const press = usePressScale(0.97);
  const inactive = disabled || loading;

  // Ink on the cyan fill (6.4:1, DESIGN.md), never white. Danger flips its text with the scheme:
  // white on light-mode red, near-black on the brighter dark-mode red.
  const look = {
    primary: { bg: theme.primary, fg: theme.onPrimary, border: theme.primary },
    secondary: { bg: theme.primarySoft, fg: theme.primaryText, border: theme.primarySoft },
    ghost: { bg: 'transparent', fg: theme.primaryText, border: 'transparent' },
    danger: { bg: theme.danger, fg: dark ? theme.canvas : '#ffffff', border: theme.danger },
  }[variant];

  return (
    <AnimatedPressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        { backgroundColor: look.bg, borderColor: look.border, opacity: disabled ? 0.45 : 1 },
        block && styles.block,
        press.style,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={look.fg} />
      ) : (
        <>
          {icon ? <SymbolView name={icon} size={size === 'lg' ? 22 : 20} tintColor={look.fg} /> : null}
          <UIText style={[size === 'lg' ? Type.bodyStrong : Type.secondaryStrong, { color: look.fg }]} numberOfLines={1}>
            {label}
          </UIText>
        </>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  lg: { height: 56, minWidth: 56, paddingHorizontal: 24, borderRadius: Radius.md },
  md: { height: 48, minWidth: 48, paddingHorizontal: 18, borderRadius: Radius.sm },
  block: { alignSelf: 'stretch' },
});
