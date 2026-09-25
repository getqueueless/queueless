import { type Href, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateCard } from '@/components/admin/state-card';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, StatusChip, UIText, type ChipStatus } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DOCTOR_STATUS_LABELS } from '@/lib/admin-doctors';
import { type Doctor, type DoctorStatusValue, formatFee } from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

type StatusRow = { doctor_id: string; status: DoctorStatusValue; late_minutes: number | null };

const CHIP: Record<DoctorStatusValue, ChipStatus> = { available: 'available', running_late: 'late', on_break: 'late', off: 'leave' };

export default function AdminDoctors() {
  const theme = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, StatusRow>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    const [docRes, svcRes, statusRes] = await Promise.all([
      supabase
        .from('doctors')
        .select('id, org_id, service_id, name, specialty, qualification, room, photo_url, fee_inr, active')
        .eq('org_id', orgId)
        .order('name'),
      supabase.from('services').select('id, name').eq('org_id', orgId),
      supabase.from('doctor_status_today').select('doctor_id, status, late_minutes').eq('org_id', orgId),
    ]);
    const error = docRes.error ?? svcRes.error ?? statusRes.error;
    if (error) {
      setLoadError(mapSupabaseError(error));
      return;
    }
    setLoadError(null);
    setDoctors((docRes.data ?? []) as Doctor[]);
    setServiceNames(Object.fromEntries((svcRes.data ?? []).map((s) => [s.id as string, s.name as string])));
    setStatuses(Object.fromEntries(((statusRes.data ?? []) as StatusRow[]).map((s) => [s.doctor_id, s])));
  }, [orgId]);
  useLiveRefresh(refetch);

  if (roleLoading || (orgId && doctors === null && !loadError)) {
    return (
      <ThemedView type="canvas" style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {!orgId ? (
            <StateCard kind="error" message="No organization assigned to this account." />
          ) : loadError ? (
            <StateCard kind="error" message={loadError} />
          ) : doctors?.length === 0 ? (
            <StateCard kind="empty" message="No doctors yet — add one below." />
          ) : (
            doctors?.map((d) => {
              const st = statuses[d.id];
              const statusText =
                st?.status === 'running_late' && st.late_minutes
                  ? `Running ${st.late_minutes} min late`
                  : DOCTOR_STATUS_LABELS[st?.status ?? 'available'];
              return (
                <Card
                  key={d.id}
                  accessibilityLabel={`${d.name}, ${d.specialty}, ${d.active ? statusText : 'inactive'}`}
                  onPress={() => router.push(`/admin/doctor?id=${d.id}` as Href)}>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <UIText variant="title3" numberOfLines={2}>
                        {d.name}
                      </UIText>
                      <UIText variant="secondary" numberOfLines={1}>
                        {d.specialty}
                      </UIText>
                      <UIText variant="secondary" numberOfLines={1}>
                        {serviceNames[d.service_id] ?? 'Unknown service'} · {formatFee(d.fee_inr)}
                      </UIText>
                    </View>
                    <UIText variant="title3" color="inkMuted" accessibilityElementsHidden importantForAccessibility="no">
                      ›
                    </UIText>
                  </View>
                  {d.active ? (
                    <StatusChip status={CHIP[st?.status ?? 'available']} label={statusText} />
                  ) : (
                    <StatusChip status="leave" label="Inactive · hidden from patients" />
                  )}
                </Card>
              );
            })
          )}

          {orgId ? <Button label="Add doctor" block onPress={() => router.push('/admin/doctor?id=new' as Href)} /> : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  scroll: { paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rowText: { flex: 1, gap: 2 },
});
