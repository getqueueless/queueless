import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const STAGGER_MS = 30;
const LETTER_MS = 420;

// display = screen titles, section = the small titles above cards. Cyan follows DESIGN.md:
// primaryDisplay is AA for large text only, so the small size takes primaryText.
const SIZES = {
  display: { min: 26, max: 34, perWidth: 0.075, base: 'ink', accent: 'primaryDisplay' },
  section: { min: 15, max: 18, perWidth: 0.043, base: 'inkSecondary', accent: 'primaryText' },
} as const;

/**
 * MedWin's two-tone heading (second word cyan unless `accent` names other words), with each
 * letter fading in, rising and scaling 0.96 → 1 on a 30 ms stagger, once on mount. Screen
 * readers get the whole text as one header; the letters are hidden from them.
 */
export function AnimatedHeading({
  text,
  accent,
  size = 'display',
  style,
}: {
  text: string;
  accent?: string;
  size?: keyof typeof SIZES;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const spec = SIZES[size];
  const fontSize = Math.round(Math.min(spec.max, Math.max(spec.min, width * spec.perWidth)));

  const words = text.split(/\s+/).filter(Boolean);
  const accentWords = new Set((accent ?? words[1] ?? '').toLowerCase().split(/\s+/));

  // Fixed at mount: text that changes later (a live count) renders in place, no replay.
  const [duration] = useState(() => LETTER_MS + STAGGER_MS * Math.max(0, words.join('').length - 1));
  const elapsed = useSharedValue(reduceMotion ? duration : 0);

  useEffect(() => {
    if (!reduceMotion) elapsed.set(withTiming(duration, { duration, easing: Easing.linear }));
    // Mount only, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const letterStyle: TextStyle = {
    fontFamily: Fonts?.poppinsBold,
    fontSize,
    lineHeight: Math.round(fontSize * 1.15),
    letterSpacing: -0.02 * fontSize,
    textTransform: 'uppercase',
  };

  let index = 0;
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={text} style={[styles.container, style]}>
      <View aria-hidden style={[styles.words, { columnGap: fontSize * 0.28 }]}>
        {words.map((word, w) => {
          const color = theme[accentWords.has(word.toLowerCase()) ? spec.accent : spec.base];
          return (
            <View key={w} style={styles.word}>
              {[...word].map((char) => {
                const i = index++;
                return (
                  <Letter
                    key={i}
                    char={char}
                    index={i}
                    elapsed={elapsed}
                    duration={duration}
                    rise={fontSize * 0.35}
                    style={[letterStyle, { color }]}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Letter({
  char,
  index,
  elapsed,
  duration,
  rise,
  style,
}: {
  char: string;
  index: number;
  elapsed: SharedValue<number>;
  duration: number;
  rise: number;
  style: StyleProp<TextStyle>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const ms = elapsed.get();
    const linear = ms >= duration ? 1 : Math.min(1, Math.max(0, (ms - index * STAGGER_MS) / LETTER_MS));
    const t = 1 - Math.pow(1 - linear, 3); // ease-out cubic
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * rise }, { scale: 0.96 + 0.04 * t }],
    };
  });

  return <Animated.Text style={[style, animatedStyle]}>{char}</Animated.Text>;
}

const styles = StyleSheet.create({
  container: { flexShrink: 1 },
  words: { flexDirection: 'row', flexWrap: 'wrap' },
  word: { flexDirection: 'row' },
});
