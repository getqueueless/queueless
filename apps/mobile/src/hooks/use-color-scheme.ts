import { useSyncExternalStore } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { getThemePreference, subscribeThemePreference } from '@/lib/theme-preference';

/** The system scheme, with the in-app choice (Settings, ThemeToggle) layered on top. */
export function useColorScheme() {
  const system = useSystemColorScheme();
  const preference = useSyncExternalStore(subscribeThemePreference, getThemePreference);
  return preference === 'system' ? system : preference;
}
