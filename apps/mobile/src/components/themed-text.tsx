import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'displayLg'
    | 'displayMd'
    | 'headingLg'
    | 'headingMd'
    | 'headingSm'
    | 'bodyLg'
    | 'body'
    | 'bodySm'
    | 'caption'
    | 'button'
    | 'tokenNumber';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[{ color: theme[themeColor ?? 'ink'] }, styles[type], style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  displayLg: { fontSize: 40, fontWeight: '600', lineHeight: 46, letterSpacing: -0.6 },
  displayMd: { fontSize: 30, fontWeight: '600', lineHeight: 36, letterSpacing: -0.4 },
  headingLg: { fontSize: 22, fontWeight: '600', lineHeight: 28, letterSpacing: -0.2 },
  headingMd: { fontSize: 18, fontWeight: '600', lineHeight: 23, letterSpacing: -0.1 },
  headingSm: { fontSize: 15, fontWeight: '600', lineHeight: 21 },
  bodyLg: { fontSize: 16, fontWeight: '400', lineHeight: 25 },
  body: { fontSize: 14, fontWeight: '400', lineHeight: 21 },
  bodySm: { fontSize: 13, fontWeight: '400', lineHeight: 19 },
  caption: { fontSize: 12, fontWeight: '500', lineHeight: 16, letterSpacing: 0.1 },
  button: { fontSize: 14, fontWeight: '500', lineHeight: 17 },
  tokenNumber: {
    fontFamily: Fonts?.mono,
    fontSize: 56,
    fontWeight: Platform.select({ android: '700' }) ?? '700',
    lineHeight: 56,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
});
