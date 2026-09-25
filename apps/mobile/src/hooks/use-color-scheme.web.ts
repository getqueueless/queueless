import { useEffect, useState, useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { getThemePreference, subscribeThemePreference } from '@/lib/theme-preference';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * The in-app choice (Settings, ThemeToggle) is layered on top of the system scheme.
 */
export function useColorScheme() {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    // Intentional: this is the standard hydration-detection pattern (flips once after mount so
    // web SSR and the client render the same thing on first paint), not a synchronization bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasHydrated(true);
  }, []);

  const colorScheme = useRNColorScheme();
  const preference = useSyncExternalStore(subscribeThemePreference, getThemePreference, () => 'system');

  if (hasHydrated) {
    return preference === 'system' ? colorScheme : preference;
  }

  return 'light';
}
