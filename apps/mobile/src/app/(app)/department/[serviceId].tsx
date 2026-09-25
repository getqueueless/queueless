import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DoctorCard } from '@/components/ui/DoctorCard';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { doctorCardStatus, fetchDoctorsForService, type DoctorWithStatus } from '@/lib/doctors';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useRequireCompleteProfile } from '@/lib/use-require-complete-profile';

type Service = { id: string; name: string };

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
                {doctors.map((doctor) => {
                  const openDoctor = () =>
                    router.push({ pathname: '/(app)/doctor/[doctorId]', params: { doctorId: doctor.id } });
                  return (
                    <DoctorCard
                      key={doctor.id}
                      name={doctor.name}
                      department={doctor.specialty}
                      feeInr={doctor.fee_inr}
                      status={doctorCardStatus(doctor)}
                      nextSlot={doctor.todayShifts[0] ?? null}
                      onPress={openDoctor}
                      onAction={openDoctor}
                    />
                  );
                })}
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
});
