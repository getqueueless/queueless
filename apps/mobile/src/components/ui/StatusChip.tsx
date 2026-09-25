import { StyleSheet, View } from 'react-native';

import type { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Radius, Type } from './tokens';
import { UIText } from './UIText';

export type ChipStatus = 'available' | 'late' | 'leave' | 'paid' | 'pending' | 'refunded';

// Each text colour passes 4.5:1 on its own soft fill in both schemes (DESIGN.md).
const LOOK: Record<ChipStatus, { label: string; fg: ThemeColor; bg: ThemeColor }> = {
  available: { label: 'Available', fg: 'success', bg: 'successSoft' },
  late: { label: 'Running late', fg: 'warning', bg: 'warningSoft' },
  leave: { label: 'On leave', fg: 'inkSecondary', bg: 'surfaceSunken' },
  paid: { label: 'Paid', fg: 'success', bg: 'successSoft' },
  pending: { label: 'Pending', fg: 'warning', bg: 'warningSoft' },
  refunded: { label: 'Refunded', fg: 'primaryText', bg: 'primarySoft' },
};

/** Doctor availability or payment state, as a dot + word. Not a tap target. */
export function StatusChip({ status, label }: { status: ChipStatus; label?: string }) {
  const theme = useTheme();
  const look = LOOK[status];
  return (
    <View style={[styles.chip, { backgroundColor: theme[look.bg] }]}>
      <View style={[styles.dot, { backgroundColor: theme[look.fg] }]} />
      <UIText style={[Type.secondaryStrong, { color: theme[look.fg] }]} numberOfLines={1}>
        {label ?? look.label}
      </UIText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
