import { SymbolView } from 'expo-symbols';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

import { AnimatedPressable, usePressScale } from './press';
import { Radius, Tones, gradient, iconFor, toneFor, type IconName, type Tone } from './tokens';
import { UIText } from './UIText';

const CLOCK: IconName = { ios: 'clock', android: 'schedule', web: 'schedule' };

export type DeptTileProps = {
  name: string;
  /** Live predicted wait in whole minutes; 0 reads "No wait", null "No estimate". */
  waitMinutes: number | null;
  onPress?: () => void;
  /** Defaults to a stable tone and icon picked from the name. */
  tone?: Tone;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
};

export function DeptTile({ name, waitMinutes, onPress, tone, icon, style }: DeptTileProps) {
  const dark = useColorScheme() === 'dark';
  const reduceMotion = useReducedMotion();
  const press = usePressScale(0.97);
  const t = Tones[tone ?? toneFor(name)][dark ? 'dark' : 'light'];

  const wait = waitMinutes === null ? 'No estimate' : waitMinutes <= 0 ? 'No wait' : `~${waitMinutes} min`;
  const spoken =
    waitMinutes === null ? 'no wait estimate' : waitMinutes <= 0 ? 'no wait' : `about ${waitMinutes} minutes wait`;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${spoken}`}
      style={[styles.tile, gradient(t.from, t.to), press.style, style]}>
      <View style={[styles.disc, { backgroundColor: dark ? 'rgba(255,255,255,0.08)' : '#ffffff' }]}>
        <SymbolView name={icon ?? iconFor(name)} size={26} tintColor={t.icon} />
      </View>
      <UIText variant="bodyStrong" numberOfLines={2}>
        {name}
      </UIText>
      {/* A new estimate fades in, so a live change is noticed without shouting. */}
      <Animated.View key={wait} entering={reduceMotion ? undefined : FadeIn.duration(250)} style={styles.wait}>
        <SymbolView name={CLOCK} size={16} tintColor={t.icon} />
        <UIText variant="secondaryStrong">{wait}</UIText>
      </Animated.View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minHeight: 148, borderRadius: Radius.lg, padding: 16, gap: 10, justifyContent: 'space-between' },
  disc: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  wait: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
