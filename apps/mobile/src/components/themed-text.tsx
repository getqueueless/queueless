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

// Headings render uppercase + Poppins 700 (style.css's dominant text-transform: uppercase
// pattern on section/card titles); body copy stays Poppins 400, sentence case. tokenNumber
// keeps the pre-existing monospace/tabular treatment untouched — see apps/mobile/DESIGN.md.
const styles = StyleSheet.create({
  displayLg: {
    fontFamily: Fonts?.poppinsBold,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  displayMd: {
    fontFamily: Fonts?.poppinsBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  headingLg: {
    fontFamily: Fonts?.poppinsBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  headingMd: {
    fontFamily: Fonts?.poppinsBold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  headingSm: {
    fontFamily: Fonts?.poppinsBold,
    fontSize: 15,
    lineHeight: 20,
  },
  bodyLg: { fontFamily: Fonts?.poppinsRegular, fontSize: 16, lineHeight: 25 },
  body: { fontFamily: Fonts?.poppinsRegular, fontSize: 14, lineHeight: 21 },
  bodySm: { fontFamily: Fonts?.poppinsRegular, fontSize: 13, lineHeight: 19 },
  caption: { fontFamily: Fonts?.poppinsRegular, fontSize: 12, lineHeight: 16, letterSpacing: 0.1 },
  button: {
    fontFamily: Fonts?.poppinsBold,
    fontSize: 14,
    lineHeight: 17,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  tokenNumber: {
    fontFamily: Fonts?.mono,
    fontSize: 56,
    fontWeight: Platform.select({ android: '700' }) ?? '700',
    lineHeight: 56,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
});
