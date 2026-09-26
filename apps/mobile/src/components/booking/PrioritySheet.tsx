import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet, Button, Card, UIText, useStickyBottomBarHeight } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/use-session';

// The only values start_paid_booking/start_paid_appointment accept for p_requested_lane
// (Hackathon database, confirmed): 'normal' (no request -- the default), 'pregnant',
// 'emergency'. 'senior' is server-detected from profiles.date_of_birth and ignored/overridden
// if sent, so it's never an option here -- shown as an informational, non-selectable row instead.
export type PriorityLane = 'normal' | 'pregnant' | 'emergency';

const NOTE_MAX = 80;

const OPTIONS: { lane: PriorityLane; label: string }[] = [
  { lane: 'normal', label: 'None' },
  { lane: 'pregnant', label: 'Pregnant' },
  { lane: 'emergency', label: 'Emergency' },
];

function ageFromDob(dob: string): number {
  const [y, m, d] = dob.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

/**
 * Asked once, right before a paid booking/token mints -- takes p_requested_lane/p_note on
 * start_paid_booking and start_paid_appointment. Staff still verify at the counter (same as the
 * existing walk-in verify_priority flow); this only records what the patient asked for.
 */
export function PrioritySheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (lane: PriorityLane, note: string | null) => void;
}) {
  const theme = useTheme();
  const barHeight = useStickyBottomBarHeight();
  const { session } = useSession();
  const [lane, setLane] = useState<PriorityLane>('normal');
  const [note, setNote] = useState('');
  const [isSenior, setIsSenior] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const userId = session?.user?.id;
    if (!userId) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('date_of_birth')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const dob = (data as { date_of_birth: string | null } | null)?.date_of_birth;
        setIsSenior(!!dob && ageFromDob(dob) >= 60);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, session?.user?.id]);

  function handleConfirm() {
    onConfirm(lane, note.trim() ? note.trim() : null);
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingBottom: barHeight }}>
        <UIText variant="title3">Do you need priority?</UIText>
        <UIText variant="secondary" style={styles.subtitle}>
          Staff verify this at the counter before it applies to your place in line.
        </UIText>

        {isSenior ? (
          <View style={[styles.seniorNote, { backgroundColor: theme.primarySoft, borderColor: theme.primaryOutline }]}>
            <UIText variant="secondaryStrong" color="primaryText">
              You&apos;re marked as a senior citizen (60+) automatically from your profile — no need to select it below.
            </UIText>
          </View>
        ) : null}

        <View style={styles.options}>
          {OPTIONS.map((opt) => {
            const selected = lane === opt.lane;
            return (
              <Card key={opt.lane} onPress={() => setLane(opt.lane)} style={selected ? { borderColor: theme.primary } : undefined}>
                <View style={styles.optionRow}>
                  <SymbolView
                    name={{ ios: selected ? 'largecircle.fill.circle' : 'circle', android: selected ? 'radio_button_checked' : 'radio_button_unchecked', web: selected ? 'radio_button_checked' : 'radio_button_unchecked' }}
                    size={22}
                    tintColor={selected ? theme.primary : theme.inkMuted}
                  />
                  <UIText variant="body" style={styles.flex}>
                    {opt.label}
                  </UIText>
                </View>
              </Card>
            );
          })}
        </View>

        {lane === 'emergency' ? (
          <View style={[styles.emergencyNote, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
            <UIText variant="secondaryStrong" color="danger">
              If this is a medical emergency, go directly to the Emergency department now — do not wait for a token.
            </UIText>
          </View>
        ) : null}

        <UIText variant="secondaryStrong" style={styles.noteLabel}>
          Note for staff (optional)
        </UIText>
        <TextInput
          value={note}
          onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))}
          placeholder="e.g. using a wheelchair"
          placeholderTextColor={theme.inkMuted}
          maxLength={NOTE_MAX}
          style={[styles.noteInput, { borderColor: theme.hairline, color: theme.ink }]}
        />
        <UIText variant="secondary" style={styles.noteCount}>
          {note.length}/{NOTE_MAX}
        </UIText>

        <UIText variant="secondary" style={styles.smallPrint}>
          Priority is confirmed by hospital staff, not automatic — misuse may be declined at the counter.
        </UIText>

        <Button label="Continue" block onPress={handleConfirm} style={styles.continueButton} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: 4, marginBottom: 16 },
  seniorNote: { borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 12 },
  options: { gap: 8 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  emergencyNote: { borderWidth: 1, borderRadius: 16, padding: 12, marginTop: 12 },
  noteLabel: { marginTop: 16, marginBottom: 6 },
  noteInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, minHeight: 48 },
  noteCount: { textAlign: 'right', marginTop: 4 },
  smallPrint: { marginTop: 16 },
  continueButton: { marginTop: 16 },
});
