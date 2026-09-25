import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { stageOf, type TrackerStatus } from '@/components/motion/queue-lane';
import { AnimatedPressable, Tones, UIText, gradient, usePressScale } from '@/components/ui';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useServiceUpdates } from '@/lib/service-updates';
import { supabase } from '@/lib/supabase';

// Same set my-tokens.tsx treats as still in play.
const ACTIVE_STATUSES = ['pending_payment', 'waiting', 'called', 'serving'];
const STAGES = ['Booked', 'Waiting', 'You’re next', 'Called', 'Done'];

type Live = {
  id: string;
  serviceId: string;
  code: string;
  serviceName: string;
  status: TrackerStatus;
  ahead: number | null;
  etaSeconds: number | null;
  counter: string | null;
  others: number;
};

/**
 * The patient's newest active token as the Home hero: code, service, place in line and wait,
 * refreshed on every queue broadcast for that service, on focus and every 10s. Renders nothing
 * when there is no active token.
 */
export function LiveTokenHero() {
  const router = useRouter();
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const press = usePressScale(0.98);
  const [live, setLive] = useState<Live | null>(null);

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id;
    if (!patientId) return;
    const { data: rows } = await supabase
      .from('tokens')
      .select('id, service_id')
      .eq('patient_id', patientId)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false });
    const newest = (rows ?? [])[0] as { id: string; service_id: string } | undefined;
    if (!newest) {
      setLive(null);
      return;
    }
    const { data: q } = await supabase.rpc('my_queue_status', { p_token: newest.id }).single();
    const s = q as {
      code: string;
      status: TrackerStatus;
      service_name: string;
      ahead: number | null;
      eta_seconds: number | null;
      counter_name: string | null;
    } | null;
    if (!s) return;
    setLive({
      id: newest.id,
      serviceId: newest.service_id,
      code: s.code,
      serviceName: s.service_name,
      status: s.status,
      ahead: s.ahead,
      etaSeconds: s.eta_seconds,
      counter: s.counter_name,
      others: (rows ?? []).length - 1,
    });
  }, []);

  useLiveRefresh(load, 10_000);
  useServiceUpdates(live ? [live.serviceId] : [], load);

  if (!live) return null;

  const stage = stageOf(live.status, live.ahead);
  const stageLabel = live.status === 'serving' ? 'With the doctor' : STAGES[stage];
  const minutes = live.etaSeconds == null ? null : Math.ceil(live.etaSeconds / 60);
  const line =
    live.status === 'called'
      ? `Go to ${live.counter ? (/^counter\b/i.test(live.counter) ? live.counter : `Counter ${live.counter}`) : 'the counter'}`
      : live.status === 'serving'
        ? 'With the doctor now'
        : live.status === 'pending_payment'
          ? 'Payment pending'
          : live.ahead === 0
            ? 'You’re next'
            : `${live.ahead ?? '?'} ahead${minutes !== null ? ` · ~${minutes} min` : ''}`;
  const tone = Tones.teal[dark ? 'dark' : 'light'];

  return (
    <View style={styles.wrap}>
      <AnimatedPressable
        onPress={() => router.push({ pathname: '/(app)/token/[id]', params: { id: live.id, serviceId: live.serviceId } })}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={`Your token ${live.code}, ${live.serviceName}. ${stageLabel}. ${line}.`}
        accessibilityHint="Opens the live tracker"
        style={[styles.hero, gradient(tone.from, tone.to), { borderColor: theme.primaryOutline }, press.style]}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <UIText variant="title1" numberOfLines={1}>
              {live.code}
            </UIText>
            <UIText variant="secondary" numberOfLines={1}>
              {live.serviceName}
            </UIText>
          </View>
          <View style={[styles.stage, { backgroundColor: theme.surface }]}>
            <UIText variant="secondaryStrong" color="primaryText">
              {stageLabel}
            </UIText>
          </View>
        </View>
        <View style={styles.row}>
          <UIText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
            {line}
          </UIText>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={20}
            tintColor={tone.icon}
          />
        </View>
      </AnimatedPressable>
      {live.others > 0 ? (
        <AnimatedPressable
          onPress={() => router.push('/(app)/my-tokens')}
          accessibilityRole="link"
          style={styles.more}>
          <UIText variant="secondaryStrong" color="primaryText">
            {live.others === 1 ? '1 more active token' : `${live.others} more active tokens`}
          </UIText>
        </AnimatedPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  hero: { borderRadius: 20, borderWidth: 1, padding: 18, gap: 14, minHeight: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  stage: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  more: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
});
