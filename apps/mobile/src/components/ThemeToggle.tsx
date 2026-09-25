import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { setThemePreference } from '@/lib/theme-preference';

// Same spec as apps/web's toggle (rebuilt from ~/code/design-ref/scene/Scene.mp4). These are the
// toggle's own colors, not theme tokens: the pill looks the same on either canvas.
const TRACK_LIGHT = '#D9DDDA';
const TRACK_MID = '#B9A3F0';
const TRACK_DARK = '#7B3FE4';
const SUN = '#5b615d'; // 6.2:1 on the white knob
const MOON = TRACK_DARK; // 5.7:1 on the white knob

const WIDTH = 60;
const HEIGHT = 30;
const PAD = 3;
const KNOB = HEIGHT - PAD * 2;
const TRAVEL = WIDTH - KNOB - PAD * 2;
const STRETCH = 0.15; // extra knob width at mid-travel
const ICON_SHIFT = KNOB;
const TIMING = { duration: 600, easing: Easing.bezier(0.65, 0, 0.35, 1) };

/** Light/dark switch: a 60×30 pill whose knob carries a sun or a moon. */
export function ThemeToggle() {
  const isDark = useColorScheme() === 'dark';
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(isDark ? 1 : 0);

  // Follows the scheme rather than the press, so a change made anywhere (Settings, the other
  // toggle, the system) animates every mounted toggle.
  useEffect(() => {
    const target = isDark ? 1 : 0;
    progress.set(reduceMotion ? target : withTiming(target, TIMING));
  }, [isDark, reduceMotion, progress]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 0.5, 1], [TRACK_LIGHT, TRACK_MID, TRACK_DARK]),
  }));

  const knobStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return { transform: [{ translateX: p * TRAVEL }, { scaleX: 1 + STRETCH * Math.sin(Math.PI * p) }] };
  });

  // Undo the stretch for the icons so they stay round.
  const iconsStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: 1 / (1 + STRETCH * Math.sin(Math.PI * progress.get())) }],
  }));

  // As on the web, the outgoing icon leaves in the direction of travel and the incoming one
  // enters from the other side, clipped to the knob. Opacity and scale stand in for a blur.
  const sunStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: interpolate(p, [0, 0.5], [1, 0], 'clamp'),
      transform: [
        { translateX: interpolate(p, [0, 0.6], [0, ICON_SHIFT], 'clamp') },
        { scale: interpolate(p, [0, 0.6], [1, 0.6], 'clamp') },
      ],
    };
  });

  const moonStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: interpolate(p, [0.5, 1], [0, 1], 'clamp'),
      transform: [
        { translateX: interpolate(p, [0.4, 1], [-ICON_SHIFT, 0], 'clamp') },
        { scale: interpolate(p, [0.4, 1], [0.6, 1], 'clamp') },
      ],
    };
  });

  function toggle() {
    setThemePreference(isDark ? 'light' : 'dark');
    Haptics.selectionAsync().catch(() => {});
  }

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="switch"
      accessibilityLabel="Dark mode"
      aria-checked={isDark}
      hitSlop={{ top: 7, bottom: 7 }}
      style={styles.pressable}>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]}>
          <View style={styles.clip}>
            <Animated.View style={[StyleSheet.absoluteFill, iconsStyle]}>
              <Animated.View style={[styles.icon, sunStyle]}>
                <SunIcon />
              </Animated.View>
              <Animated.View style={[styles.icon, moonStyle]}>
                <MoonIcon />
              </Animated.View>
            </Animated.View>
          </View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];

function SunIcon() {
  return (
    <View style={styles.glyph}>
      <View style={styles.sunCore} />
      {RAYS.map((angle) => (
        <View key={angle} style={[styles.ray, { transform: [{ rotate: `${angle}deg` }, { translateY: -5.5 }] }]} />
      ))}
    </View>
  );
}

// A disc with a knob-white disc laid over its top-right edge, clipped to the glyph box.
function MoonIcon() {
  return (
    <View style={[styles.glyph, styles.moonClip]}>
      <View style={styles.moonDisc} />
      <View style={styles.moonCut} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: HEIGHT / 2 }, // rounds the web focus ring
  track: {
    width: WIDTH,
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  // The shadow lives on this outer layer: iOS clips a view's own shadow when it has
  // overflow: hidden, so the clipping happens one layer down.
  knob: {
    position: 'absolute',
    top: PAD - StyleSheet.hairlineWidth,
    left: PAD - StyleSheet.hairlineWidth,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#ffffff',
    shadowColor: '#1a3237',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 3,
    elevation: 3,
  },
  clip: {
    ...StyleSheet.absoluteFill,
    borderRadius: KNOB / 2,
    overflow: 'hidden',
  },
  icon: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  sunCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: SUN },
  ray: {
    position: 'absolute',
    top: 5.5,
    left: 6.2,
    width: 1.6,
    height: 3,
    borderRadius: 0.8,
    backgroundColor: SUN,
  },
  moonClip: { overflow: 'hidden' },
  moonDisc: { width: 12, height: 12, borderRadius: 6, backgroundColor: MOON },
  moonCut: {
    position: 'absolute',
    top: -2.5,
    left: 5.5,
    width: 10.5,
    height: 10.5,
    borderRadius: 5.25,
    backgroundColor: '#ffffff',
  },
});
