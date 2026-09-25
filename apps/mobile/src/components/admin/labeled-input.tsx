import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type LabeledInputProps = TextInputProps & { label: string };

/** Label + TextInput, styled consistently across the admin Services/Counters edit and add forms. */
export function LabeledInput({ label, style, ...rest }: LabeledInputProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <ThemedText type="caption" themeColor="inkMuted">
        {label}
      </ThemedText>
      <TextInput
        placeholderTextColor={theme.inkMuted}
        style={[styles.input, { color: theme.ink, borderColor: theme.hairline }, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xxs },
  input: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
  },
});
