import { StyleSheet, View } from 'react-native';

import { AnimatedHeading } from '@/components/AnimatedHeading';

import { Button } from './Button';

export type SectionHeaderProps = {
  title: string;
  /** Word(s) in cyan; defaults to the second word, like every AnimatedHeading. */
  accent?: string;
  /** A trailing text action such as "See all". */
  action?: { label: string; onPress: () => void };
};

/** A 22pt section title that letters in once (AnimatedHeading), with an optional action. */
export function SectionHeader({ title, accent, action }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <AnimatedHeading text={title} accent={accent} size="title" />
      {action ? <Button label={action.label} onPress={action.onPress} variant="ghost" size="md" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48 },
});
