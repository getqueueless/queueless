import { Text, type TextProps } from 'react-native';

import type { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Type, type TypeVariant } from './tokens';

export type UITextProps = TextProps & { variant?: TypeVariant; color?: ThemeColor };

/** Text on the redesign's scale (body 17, secondary 15, titles 22/28/34). Sentence case. */
export function UIText({ variant = 'body', color, style, ...rest }: UITextProps) {
  const theme = useTheme();
  const fallback = variant === 'secondary' ? 'inkSecondary' : 'ink';
  return <Text style={[Type[variant], { color: theme[color ?? fallback] }, style]} {...rest} />;
}
