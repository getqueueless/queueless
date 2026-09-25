import { StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';

import { Tones, gradient, toneFor } from './tokens';
import { UIText } from './UIText';

function initials(name: string) {
  return name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Initials on the person's own tone (stable per name). Decorative: the name is always beside it. */
export function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const tone = Tones[toneFor(name)][useColorScheme() === 'dark' ? 'dark' : 'light'];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }, gradient(tone.from, tone.to)]}>
      <UIText variant="title3" style={{ color: tone.icon }}>
        {initials(name)}
      </UIText>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
});
