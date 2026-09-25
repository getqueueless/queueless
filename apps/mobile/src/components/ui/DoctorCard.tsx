import { StyleSheet, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatFee } from '@/lib/doctors';

import { Button } from './Button';
import { AnimatedPressable, usePressScale } from './press';
import { Card } from './Card';
import { StatusChip } from './StatusChip';
import { Tones, gradient, toneFor } from './tokens';
import { UIText } from './UIText';

export type DoctorCardProps = {
  name: string;
  department: string;
  feeInr: number | null;
  status: 'available' | 'late' | 'leave';
  /** Already formatted, e.g. "Today, 11:30 AM"; null hides the line. */
  nextSlot?: string | null;
  actionLabel?: string;
  onAction?: () => void;
  actionLoading?: boolean;
  /** Defaults to disabled while the doctor is on leave. */
  actionDisabled?: boolean;
  /**
   * Opens the doctor's page. Only the name row becomes the tap target: the action button is its
   * sibling, never nested inside it, so screen readers can reach both.
   */
  onPress?: () => void;
};

function initials(name: string) {
  return name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function DoctorCard({
  name,
  department,
  feeInr,
  status,
  nextSlot,
  actionLabel = 'Book',
  onAction,
  actionLoading,
  actionDisabled = status === 'leave',
  onPress,
}: DoctorCardProps) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const tone = Tones[toneFor(name)][dark ? 'dark' : 'light'];
  const fee = feeInr === null ? null : formatFee(feeInr);
  const press = usePressScale(0.98);

  return (
    <Card>
      <AnimatedPressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : undefined}
        accessibilityHint={onPress ? 'Opens the doctor’s page' : undefined}
        style={[styles.top, press.style]}>
        <View style={[styles.avatar, gradient(tone.from, tone.to)]} accessibilityElementsHidden importantForAccessibility="no">
          <UIText variant="title3" style={{ color: tone.icon }}>
            {initials(name)}
          </UIText>
        </View>
        <View style={styles.info}>
          <UIText variant="bodyStrong" numberOfLines={2}>
            {name}
          </UIText>
          <UIText variant="secondary" numberOfLines={1}>
            {department}
            {fee ? ` · ${fee}` : ''}
          </UIText>
          <StatusChip status={status} />
        </View>
      </AnimatedPressable>
      <View style={[styles.bottom, { borderTopColor: theme.hairline }]}>
        <View style={styles.slot}>
          <UIText variant="secondary">Next slot</UIText>
          <UIText variant="bodyStrong" numberOfLines={1}>
            {nextSlot ?? (status === 'leave' ? 'Not today' : '—')}
          </UIText>
        </View>
        <Button
          label={actionLabel}
          size="md"
          onPress={onAction}
          loading={actionLoading}
          disabled={actionDisabled}
          accessibilityHint={`${actionLabel} with ${name}`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 4 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1 },
  slot: { flex: 1 },
});
