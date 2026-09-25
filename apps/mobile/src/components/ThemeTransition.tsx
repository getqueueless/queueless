import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeThemePreference } from '@/lib/theme-preference';

// Armed only by a real preference change (a ThemeToggle, Settings), so web hydration and an OS
// sunset flip never flash.
let armed = false;
subscribeThemePreference(() => {
  armed = true;
});

type Fade = { key: number; from: string };

/**
 * Wraps the app so every theme change is seen: in the same commit that repaints the app in the new
 * theme, an overlay in the OLD canvas colour covers the screen and fades out over 350 ms.
 * Reduce Motion swaps instantly.
 */
export function ThemeTransitionHost({ children }: { children: ReactNode }) {
  const scheme: 'light' | 'dark' = useColorScheme() === 'dark' ? 'dark' : 'light';
  const reduceMotion = useReducedMotion();
  const [prevScheme, setPrevScheme] = useState(scheme);
  const [fade, setFade] = useState<Fade | null>(null);

  // Adjusting state while rendering (React's documented pattern) puts the overlay in the very
  // commit that repaints the app, so the old colours never snap.
  if (scheme !== prevScheme) {
    setPrevScheme(scheme);
    if (armed && !reduceMotion) setFade({ key: (fade?.key ?? 0) + 1, from: Colors[prevScheme].canvasSoft });
  }

  // Disarm after the commit that used it.
  useEffect(() => {
    armed = false;
  }, [scheme]);

  return (
    // The themed canvas under everything, so a screen with a transparent root never shows the
    // page (web) or window (native) colour of the other theme.
    <View style={[styles.flex, { backgroundColor: Colors[scheme].canvasSoft }]}>
      {children}
      {fade ? <Overlay key={fade.key} color={fade.from} onDone={() => setFade(null)} /> : null}
    </View>
  );
}

function Overlay({ color, onDone }: { color: string; onDone: () => void }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.set(
      withTiming(0, { duration: 350, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onDone)();
      }),
    );
    // Mount only: each theme change gets its own keyed overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
