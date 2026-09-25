import { StyleSheet, View } from 'react-native';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';

/**
 * MedWin's two-tone heading pattern (index.html:127's `Book <span style="color:#0cb7d6">
 * Appointment</span>`) as a reusable component instead of hand-splitting <Text> runs per screen.
 * `accent` matches whole words in `text` case-insensitively and renders just those in `primary`.
 */
export function TwoToneHeading({
  text,
  accent,
  type = 'displayMd',
  style,
}: {
  text: string;
  accent: string;
  type?: ThemedTextProps['type'];
} & Pick<ThemedTextProps, 'style'>) {
  const accentWords = new Set(accent.toLowerCase().split(/\s+/));
  const words = text.split(/(\s+)/);

  return (
    <View style={styles.row}>
      <ThemedText type={type} style={style}>
        {words.map((word, i) =>
          accentWords.has(word.toLowerCase()) ? (
            <ThemedText key={i} type={type} themeColor="primary">
              {word}
            </ThemedText>
          ) : (
            word
          ),
        )}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexShrink: 1 },
});
