import { Poppins_400Regular, Poppins_700Bold, useFonts } from '@expo-google-fonts/poppins';
import { Slot } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Appearance, Platform } from 'react-native';

import { ThemeTransitionHost } from '@/components/ThemeTransition';
import { ThemedView } from '@/components/themed-view';
import { hideSplash } from '@/lib/splash';
import { getThemePreference, subscribeThemePreference } from '@/lib/theme-preference';
import { useSession } from '@/lib/use-session';

export default function RootLayout() {
  const { session, loading } = useSession();
  const [fontsLoaded] = useFonts({ Poppins_400Regular, Poppins_700Bold });
  const ready = !loading && fontsLoaded;

  // Native chrome (the iOS tab bar's glass, alerts, keyboard) follows the OS scheme, not the
  // in-app theme. Push the in-app choice down so a light app never sits under dark glass.
  const themePreference = useSyncExternalStore(subscribeThemePreference, getThemePreference);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Appearance.setColorScheme(themePreference === 'system' ? 'unspecified' : themePreference);
  }, [themePreference]);

  // Signed out: the sign-in screen is next, show it. Signed in: the tabs layout hides the
  // splash once the role is known; the timer is a backstop for deep links that skip the tabs.
  useEffect(() => {
    if (!ready) return;
    if (!session) {
      hideSplash();
      return;
    }
    const backstop = setTimeout(hideSplash, 3000);
    return () => clearTimeout(backstop);
  }, [ready, session]);

  if (!ready) {
    return <ThemedView style={{ flex: 1 }} />;
  }

  // Every theme change, from any screen, fades through the host's overlay.
  return (
    <ThemeTransitionHost>
      <Slot />
    </ThemeTransitionHost>
  );
}
