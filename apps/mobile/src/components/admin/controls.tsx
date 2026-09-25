import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button, Card as KitCard, MIN_TAP, Radius, UIText } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

// Thin wrappers over the UI kit, kept for the admin Doctors, Payments, Cash and Cash desk screens
// so their call sites don't change. New code can use '@/components/ui' directly.

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <KitCard style={style}>{children}</KitCard>;
}

export function PrimaryButton({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return <Button label={label} onPress={onPress} loading={busy} disabled={disabled} size="md" block style={styles.grow} />;
}

export function OutlineButton({
  label,
  onPress,
  danger,
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  // Danger stays an outline (red text, red border): a solid red fill on every Delete/Refund row
  // shouted louder than the primary action next to it.
  if (danger) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.outline, { borderColor: theme.danger, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
        <UIText variant="secondaryStrong" color="danger">
          {label}
        </UIText>
      </Pressable>
    );
  }
  return (
    <Button
      label={label}
      onPress={onPress}
      disabled={disabled}
      variant="secondary"
      size="md"
      block
      accessibilityHint={accessibilityHint}
    />
  );
}

/** Single-select chip row, 48pt tall chips. */
export function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? theme.primary : theme.surface,
                borderColor: selected ? theme.primary : theme.hairlineStrong,
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <UIText variant={selected ? 'secondaryStrong' : 'secondary'} color={selected ? 'onPrimary' : 'ink'}>
              {o.label}
            </UIText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  outline: {
    flexGrow: 1,
    minHeight: MIN_TAP,
    borderWidth: 1.5,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: MIN_TAP,
    minWidth: MIN_TAP,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
