import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Same look as the Services/Counters screens' inline buttons and cards, shared by the Doctors,
// Cash desk and Cash report screens so each of those doesn't restate the styles.

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <ThemedView type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }, style]}>
      {children}
    </ThemedView>
  );
}

export function PrimaryButton({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const theme = useTheme();
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      style={[styles.button, { backgroundColor: theme.primary, opacity: off ? 0.6 : 1 }]}>
      {busy ? <ActivityIndicator color={theme.onPrimary} /> : <ThemedText type="button" themeColor="onPrimary">{label}</ThemedText>}
    </Pressable>
  );
}

export function OutlineButton({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.outline, { borderColor: theme.hairline, opacity: disabled ? 0.6 : 1 }]}>
      <ThemedText type="button" themeColor={danger ? 'danger' : 'ink'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Single-select chip row. */
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
            style={[
              styles.chip,
              { backgroundColor: selected ? theme.primary : theme.surface, borderColor: selected ? theme.primary : theme.hairline },
            ]}>
            <ThemedText type="bodySm" themeColor={selected ? 'onPrimary' : 'ink'}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.md, gap: Spacing.sm },
  button: {
    flexGrow: 1,
    minHeight: 44,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  outline: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Rounded.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { minHeight: 36, borderWidth: 1, borderRadius: Rounded.md, paddingHorizontal: Spacing.sm, justifyContent: 'center' },
});
