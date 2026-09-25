import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Avatar } from './Avatar';
import { Card } from './Card';
import { StickyBottomBar, useStickyBottomBarHeight } from './StickyBottomBar';
import { UIText } from './UIText';

const inr = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

/** "9:42" from milliseconds left. */
function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type CheckoutSummaryProps = {
  doctor: { name: string; department: string };
  /** Price breakdown; the total is their sum. Amounts come from the server (tokens.fee_inr). */
  lines: { label: string; amountInr: number }[];
  /** tokens.hold_expires_at for a pending_payment hold; null or omitted hides the countdown. */
  holdExpiresAt?: string | Date | null;
  onProceed: () => void;
  ctaLabel?: string;
  loading?: boolean;
  /** Extra content under the breakdown (policy notes, errors). */
  children?: ReactNode;
};

/**
 * The pay screen's body: doctor, price breakdown, the hold's live countdown, and a sticky
 * "Proceed to payment" bar. Fills its parent; render it as the screen's only child. The CTA
 * turns off by itself when the hold runs out.
 */
export function CheckoutSummary({
  doctor,
  lines,
  holdExpiresAt,
  onProceed,
  ctaLabel = 'Proceed to payment',
  loading,
  children,
}: CheckoutSummaryProps) {
  const theme = useTheme();
  const barHeight = useStickyBottomBarHeight();
  const total = lines.reduce((sum, l) => sum + l.amountInr, 0);

  // The one clock here counts down a real server deadline (hold_expires_at); it adds no state.
  const deadline = holdExpiresAt ? new Date(holdExpiresAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  const left = deadline === null ? null : deadline - now;
  const expired = left !== null && left <= 0;

  const hold: { bg: ThemeColor; fg: ThemeColor; text: string } | null =
    left === null
      ? null
      : expired
        ? { bg: 'dangerSoft', fg: 'danger', text: 'Hold expired. Go back and book again.' }
        : { bg: left < 60_000 ? 'warningSoft' : 'primarySoft', fg: left < 60_000 ? 'warning' : 'primaryText', text: `Your place is held for ${clock(left)}` };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: barHeight + 24 }]}>
        <View style={styles.doctor}>
          <Avatar name={doctor.name} />
          <View style={styles.flex}>
            <UIText variant="bodyStrong" numberOfLines={2}>
              {doctor.name}
            </UIText>
            <UIText variant="secondary">{doctor.department}</UIText>
          </View>
        </View>

        {hold ? (
          <View
            style={[styles.hold, { backgroundColor: theme[hold.bg] }]}
            accessible
            // Read as whole minutes: a per-second label would be noise to a screen reader.
            accessibilityLabel={
              expired ? hold.text : `Your place is held for about ${Math.ceil((left ?? 0) / 60_000)} minutes`
            }>
            <SymbolView name={{ ios: 'timer', android: 'timer', web: 'timer' }} size={22} tintColor={theme[hold.fg]} />
            <UIText variant="bodyStrong" style={[styles.flex, { color: theme[hold.fg], fontVariant: ['tabular-nums'] }]}>
              {hold.text}
            </UIText>
          </View>
        ) : null}

        <Card>
          {lines.map((l) => (
            <View key={l.label} style={styles.line}>
              <UIText color="inkSecondary" style={styles.flex}>
                {l.label}
              </UIText>
              <UIText>{inr(l.amountInr)}</UIText>
            </View>
          ))}
          <View style={[styles.line, styles.totalLine, { borderTopColor: theme.hairline }]}>
            <UIText variant="bodyStrong" style={styles.flex}>
              Total
            </UIText>
            <UIText variant="title3">{inr(total)}</UIText>
          </View>
        </Card>

        {children}
      </ScrollView>
      <StickyBottomBar total={inr(total)} cta={ctaLabel} onPress={onProceed} loading={loading} disabled={expired} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20, gap: 16 },
  doctor: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hold: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 14, minHeight: 48 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  totalLine: { borderTopWidth: 1, paddingTop: 12 },
});
