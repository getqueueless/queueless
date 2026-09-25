import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

import { Button } from './Button';
import { UIText } from './UIText';

const PAD = 12;
const BUTTON = 56;

export type StickyBottomBarProps = {
  /** Already formatted, e.g. "₹300". */
  total: string;
  totalLabel?: string;
  cta: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

/** Height the bar covers, so a screen can pad its scroll content by the same amount. */
export function useStickyBottomBarHeight() {
  const insets = useSafeAreaInsets();
  return PAD + BUTTON + Math.max(insets.bottom, PAD) + 1;
}

/**
 * Checkout bar pinned to the bottom of the screen: total on the left, the CTA on the right,
 * clear of the home indicator. Render it last, as a sibling of the screen's ScrollView.
 */
export function StickyBottomBar({ total, totalLabel = 'Total', cta, onPress, loading, disabled }: StickyBottomBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, PAD), backgroundColor: theme.surface, borderTopColor: theme.hairline },
      ]}>
      <View style={styles.total} accessible accessibilityLabel={`${totalLabel} ${total}`}>
        <UIText variant="secondary">{totalLabel}</UIText>
        <UIText variant="title3" numberOfLines={1}>
          {total}
        </UIText>
      </View>
      <Button label={cta} onPress={onPress} loading={loading} disabled={disabled} style={styles.cta} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: PAD,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 8,
  },
  total: { flex: 1 },
  cta: { flexShrink: 0, minWidth: 168 },
});
