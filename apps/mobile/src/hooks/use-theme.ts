/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useEffect, useState } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getThemePreference, subscribeThemePreference } from '@/lib/theme-preference';

export function useTheme() {
  const scheme = useColorScheme();
  const [preference, setPreference] = useState(getThemePreference);

  useEffect(() => subscribeThemePreference(() => setPreference(getThemePreference())), []);

  const resolved = preference === 'system' ? scheme : preference;
  return Colors[resolved === 'dark' ? 'dark' : 'light'];
}
