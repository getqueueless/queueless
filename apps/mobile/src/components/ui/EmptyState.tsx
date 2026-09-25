import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { Button } from './Button';
import type { IconName } from './tokens';
import { UIText } from './UIText';

export type EmptyStateProps = {
  icon: IconName;
  title: string;
  text: string;
  action?: { label: string; onPress: () => void };
};

/** Nothing to show yet: an icon, what is missing, what to do about it. */
export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.disc, { backgroundColor: theme.primarySoft }]}>
        <SymbolView name={icon} size={36} tintColor={theme.primaryText} />
      </View>
      <UIText variant="title3" style={styles.center} accessibilityRole="header">
        {title}
      </UIText>
      <UIText color="inkSecondary" style={styles.center}>
        {text}
      </UIText>
      {action ? <Button label={action.label} onPress={action.onPress} style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 12, paddingVertical: 32, paddingHorizontal: 24 },
  disc: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  center: { textAlign: 'center' },
  action: { alignSelf: 'center', marginTop: 8 },
});
