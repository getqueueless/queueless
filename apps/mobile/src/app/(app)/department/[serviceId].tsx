import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { doctorStatusLabel, fetchDoctorsForService, formatFee, type DoctorWithStatus } from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useRequireCompleteProfile } from '@/lib/use-require-complete-profile';

type Service = { id: string; name: string };

const STATUS_COLOR: Record<DoctorWithStatus['status'], ThemeColor> = {
  available: 'success',
  running_late: 'warning',
  on_break: 'warning',
  off: 'danger',
};
const STATUS_SOFT: Record<DoctorWithStatus['status'], ThemeColor> = {
  available: 'successSoft',
  running_late: 'warningSoft',
  on_break: 'warningSoft',
  off: 'dangerSoft',
};

function StatusBadge({ doctor }: { doctor: DoctorWithStatus }) {
  const key = doctor.onLeaveToday ? 'off' : doctor.status;
  return (
    <ThemedView type={STATUS_SOFT[key]} style={styles.statusBadge}>
      <ThemedText type="caption" themeColor={STATUS_COLOR[key]}>
        {doctorStatusLabel(doctor)}
      </ThemedText>
    </ThemedView>
  );
}

function DoctorCard({ doctor, onPress }: { doctor: DoctorWithStatus; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.doctorCard,
        CardShadow,
        { backgroundColor: theme.surface, borderColor: theme.hairline, opacity: pressed ? 0.85 : 1 },
      ]}>
      <View style={styles.doctorHeaderRow}>
        <ThemedText type="headingSm" style={styles.doctorName}>
          {doctor.name}
        </ThemedText>
        <StatusBadge doctor={doctor} />
      </View>
      <ThemedText type="bodySm" themeColor="inkSecondary">
        {doctor.specialty}
        {doctor.qualification ? ` · ${doctor.qualification}` : ''}
      </ThemedText>
      <View style={styles.doctorMetaRow}>
        <ThemedText type="bodySm" themeColor="primaryText">
          {formatFee(doctor.fee_inr)} consultation
        </ThemedText>
      </View>
      {doctor.todayShifts.length > 0 ? (
        <ThemedText type="caption" themeColor="inkMuted">
          Today: {doctor.todayShifts.join(', ')}
        </ThemedText>
      ) : (
        <ThemedText type="caption" themeColor="inkMuted">
          No shifts scheduled today
        </ThemedText>
      )}
    </Pressable>
  );
}

export default function Department() {
  const params = useLocalSearchParams<{ serviceId: string }>();
  const serviceId = params.serviceId;
  const router = useRouter();
  const theme = useTheme();
  const ready = useRequireCompleteProfile();

  const [service, setService] = useState<Service | null>(null);
  const [doctors, setDoctors] = useState<DoctorWithStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [takingToken, setTakingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !serviceId) return;
    let cancelled = false;

    async function load() {
      try {
        const [serviceRes, doctorRows] = await Promise.all([
          supabase.from('services').select('id, name').eq('id', serviceId).single(),
          fetchDoctorsForService(serviceId),
        ]);
        if (cancelled) return;
        if (serviceRes.error) throw serviceRes.error;
        setService(serviceRes.data as Service);
        setDoctors(doctorRows);
      } catch {
        if (!cancelled) setLoadError("Couldn't load doctors right now — check your connection and try again.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [ready, serviceId]);

  async function takeAnyAvailable() {
    if (!serviceId || takingToken) return;
    setTakingToken(true);
    setTokenError(null);

    const { data, error } = await supabase.rpc('issue_token', { p_service: serviceId });

    if (!error && data) {
      const ticket = data as { id: string };
      setTakingToken(false);
      router.push({ pathname: '/(app)/token/[id]', params: { id: ticket.id, serviceId } });
      return;
    }

    if (error && (error.code === 'already_active' || error.message === 'already_active')) {
      try {
        const raw = (error as { details?: string }).details;
        const details = typeof raw === 'string' ? JSON.parse(raw) : null;
        if (details?.id) {
          setTakingToken(false);
          router.push({ pathname: '/(app)/token/[id]', params: { id: details.id, serviceId } });
          return;
        }
      } catch {
        // Malformed/missing details — fall through to the mapped error below.
      }
    }

    setTakingToken(false);
    setTokenError(mapSupabaseError({ code: error?.code, message: error?.message }));
  }

  if (!ready) return null;

  return (
    <ThemedView type="canvas" style={styles.container}>
      <Stack.Screen options={{ title: service?.name ?? 'Department' }} />
      <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.flex}>
        {doctors === null && !loadError ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : loadError ? (
          <View style={styles.centerFill}>
            <ThemedText type="body" themeColor="inkMuted" style={styles.centerText}>
              {loadError}
            </ThemedText>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Pressable
              onPress={takeAnyAvailable}
              disabled={takingToken}
              style={({ pressed }) => [
                styles.anyCard,
                CardShadow,
                { backgroundColor: theme.primarySoft, borderColor: theme.primaryOutline, opacity: pressed || takingToken ? 0.85 : 1 },
              ]}>
              <ThemedText type="headingMd">Any available doctor</ThemedText>
              <ThemedText type="bodySm" themeColor="inkSecondary" style={styles.anyCardSubtitle}>
                Fastest option — join this department&apos;s walk-in queue now.
              </ThemedText>
              {takingToken ? (
                <ActivityIndicator color={theme.primary} style={styles.anyCardSpinner} />
              ) : (
                <ThemedText type="button" themeColor="primaryText">
                  Take token
                </ThemedText>
              )}
            </Pressable>

            {tokenError ? (
              <ThemedText type="bodySm" themeColor="danger" style={styles.errorText}>
                {tokenError}
              </ThemedText>
            ) : null}

            {doctors && doctors.length > 0 ? (
              <>
                <ThemedText type="headingSm" style={styles.sectionLabel}>
                  Or choose a doctor to book
                </ThemedText>
                {doctors.map((doctor) => (
                  <DoctorCard
                    key={doctor.id}
                    doctor={doctor}
                    onPress={() => router.push({ pathname: '/(app)/doctor/[doctorId]', params: { doctorId: doctor.id } })}
                  />
                ))}
              </>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  centerText: { textAlign: 'center' },
  list: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  anyCard: {
    borderWidth: 1,
    borderRadius: Rounded.xl,
    padding: Spacing.lg,
    gap: Spacing.xxs,
  },
  anyCardSubtitle: { marginBottom: Spacing.xs },
  anyCardSpinner: { alignSelf: 'flex-start', marginTop: Spacing.xxs },
  errorText: { marginTop: -Spacing.xs },
  sectionLabel: { marginTop: Spacing.sm },
  doctorCard: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
    gap: Spacing.xxs,
  },
  doctorHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.xs },
  doctorName: { flexShrink: 1 },
  doctorMetaRow: { marginTop: Spacing.xxs },
  statusBadge: {
    borderRadius: Rounded.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
});
