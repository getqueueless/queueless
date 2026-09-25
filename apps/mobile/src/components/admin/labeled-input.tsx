import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { MIN_TAP, Radius, Type, UIText } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

type LabeledInputProps = TextInputProps & { label: string };

/** 15pt label over a 48pt, 17pt-text field; shared by the admin forms and the cash desk. */
export function LabeledInput({ label, style, ...rest }: LabeledInputProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <UIText variant="secondary">{label}</UIText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.inkMuted}
        style={[
          styles.input,
          { color: theme.ink, borderColor: theme.hairlineStrong, backgroundColor: theme.surfaceSunken },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  input: {
    fontFamily: Type.body.fontFamily,
    fontSize: Type.body.fontSize,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: MIN_TAP,
  },
});
