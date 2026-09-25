import { StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

import { AnimatedPressable, usePressScale } from './press';
import { MIN_TAP, Radius, Type } from './tokens';
import { UIText } from './UIText';

/** A tappable filter pill (department filters on the Doctors tab). Not for fixed-vocabulary
 * status -- see StatusChip for Available/Paid/Refunded/etc. */
export function Chip({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const press = usePressScale(0.95);

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        { borderColor: selected ? theme.primary : theme.hairline, backgroundColor: selected ? theme.primarySoft : theme.surface },
        press.style,
      ]}>
      <UIText style={[Type.secondaryStrong, { color: theme[selected ? 'primaryText' : 'inkSecondary'] }]}>{label}</UIText>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TAP,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
  },
});
