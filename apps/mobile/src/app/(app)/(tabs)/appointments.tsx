import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isCheckInWindow } from '@/lib/appointmentWindow';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

type Service = { id: string; name: string; is_open: boolean };
type Slot = { id: string; service_id: string; starts_at: string };
// ponytail: schema unconfirmed (migrations not landed yet) — appointments may key a slot by
// slot_id OR service_id+starts_at, so findMine() below checks both. Reconcile once real
// migrations land.
type Appointment = { id: string; slot_id?: string; service_id?: string; starts_at: string; status: string };

function formatSlot(startsAt: string) {
  const d = new Date(startsAt);
  const date = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export default function AppointmentsScreen() {
  const theme = useTheme();

  const [services, setServices] = useState<Service[] | null>(null);
  const [servicesError, setServicesError] = useState<string | null>(null);

  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [myAppointments, setMyAppointments] = useState<Appointment[]>([]);

  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    loadServices();
  }, []);

  async function loadServices() {
    setServicesError(null);
    const { data, error } = await supabase.from('services').select('*').eq('is_open', true);
    if (error) {
      setServicesError(mapSupabaseError({ code: error.code, message: error.message }));
      return;
    }
    setServices(data ?? []);
  }

  async function loadSlots(serviceId: string) {
    setSlotsLoading(true);
    setSlotsError(null);
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id ?? '';
    const [slotsRes, apptRes] = await Promise.all([
      supabase
        .from('appointment_slots')
        .select('*')
        .eq('service_id', serviceId)
        .gt('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true }),
      // Filter on patient_id here: appointments has no RLS on prod yet (docs/DECISIONS.md), so an
      // unfiltered select returned every patient's bookings as "mine".
      supabase.from('appointments').select('*').eq('patient_id', patientId),
    ]);
    setSlotsLoading(false);

    if (slotsRes.error) {
      setSlotsError(mapSupabaseError({ code: slotsRes.error.code, message: slotsRes.error.message }));
      setSlots(null);
      return;
    }
    setSlots(slotsRes.data ?? []);
    if (!apptRes.error) {
      setMyAppointments((apptRes.data ?? []).filter((a: Appointment) => a.status === 'booked'));
    }
  }

  function selectService(service: Service) {
    setSelectedService(service);
    setActionError(null);
    setSlots(null);
    loadSlots(service.id);
  }

  function backToServices() {
    setSelectedService(null);
    setSlots(null);
    setSlotsError(null);
    setActionError(null);
  }

  function findMine(slot: Slot) {
    return myAppointments.find((a) =>
      a.slot_id ? a.slot_id === slot.id : a.service_id === slot.service_id && a.starts_at === slot.starts_at,
    );
  }

  async function handleBook(slot: Slot) {
    if (!selectedService) return;
    setActionError(null);
    setPendingId(slot.id);
    const { error } = await supabase.rpc('book_appointment', { p_slot: slot.id });
    if (error) setActionError(mapSupabaseError({ code: error.code, message: error.message }));
    // Refetch regardless of outcome so a stale Book button on a now-unavailable slot never lingers.
    await loadSlots(selectedService.id);
    setPendingId(null);
  }

  async function handleCancel(appt: Appointment) {
    if (!selectedService) return;
    setActionError(null);
    setPendingId(appt.id);
    const { error } = await supabase.rpc('cancel_appointment', { p_appointment: appt.id });
    if (error) setActionError(mapSupabaseError({ code: error.code, message: error.message }));
    await loadSlots(selectedService.id);
    setPendingId(null);
  }

  async function handleCheckIn(appt: Appointment) {
    if (!selectedService) return;
    setActionError(null);
    setPendingId(appt.id);
    const { data, error } = await supabase.rpc('check_in', { p_appointment: appt.id });
    setPendingId(null);
    if (error) {
      setActionError(mapSupabaseError({ code: error.code, message: error.message }));
      await loadSlots(selectedService.id);
      return;
    }
    const token = data as { id: string } | null;
    if (token?.id) {
      // Object form (not a template string) so this still type-checks under expo-router's
      // typedRoutes once apps/mobile/src/app/(app)/token/[id].tsx exists.
      router.push({ pathname: '/(app)/token/[id]', params: { id: token.id, serviceId: selectedService.id } });
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ThemedText type="displayMd" style={styles.title}>
          Appointments
        </ThemedText>

        {!selectedService ? (
          <ScrollView contentContainerStyle={styles.list}>
            {services === null && !servicesError ? <ActivityIndicator color={theme.primary} style={styles.spinner} /> : null}

            {servicesError ? (
              <View style={[styles.banner, { backgroundColor: theme.dangerSoft, borderLeftColor: theme.danger }]}>
                <ThemedText type="bodySm" themeColor="danger">
                  {servicesError}
                </ThemedText>
                <Pressable onPress={loadServices} hitSlop={8} style={styles.retryLink}>
                  <ThemedText type="button" themeColor="danger" style={styles.retryText}>
                    Retry
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            {services && services.length === 0 && !servicesError ? (
              <View style={styles.emptyState}>
                <ThemedText type="body" themeColor="inkSecondary" style={styles.emptyText}>
                  No services are open right now. Check back later.
                </ThemedText>
              </View>
            ) : null}

            {services?.map((service) => (
              <Pressable
                key={service.id}
                onPress={() => selectService(service)}
                style={({ pressed }) => [
                  styles.card,
                  CardShadow,
                  { borderColor: theme.hairline, backgroundColor: theme.surface, opacity: pressed ? 0.85 : 1 },
                ]}>
                <ThemedText type="headingSm">{service.name}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            <Pressable onPress={backToServices} hitSlop={8} style={styles.backRow}>
              <ThemedText type="button" themeColor="ink">
                ‹ Change service
              </ThemedText>
            </Pressable>

            <ThemedText type="headingMd" style={styles.serviceTitle}>
              {selectedService.name}
            </ThemedText>

            {actionError ? (
              <View style={[styles.banner, { backgroundColor: theme.dangerSoft, borderLeftColor: theme.danger }]}>
                <ThemedText type="bodySm" themeColor="danger">
                  {actionError}
                </ThemedText>
              </View>
            ) : null}

            {slotsLoading && slots === null ? <ActivityIndicator color={theme.primary} style={styles.spinner} /> : null}

            {slotsError ? (
              <View style={[styles.banner, { backgroundColor: theme.dangerSoft, borderLeftColor: theme.danger }]}>
                <ThemedText type="bodySm" themeColor="danger">
                  {slotsError}
                </ThemedText>
                <Pressable onPress={() => loadSlots(selectedService.id)} hitSlop={8} style={styles.retryLink}>
                  <ThemedText type="button" themeColor="danger" style={styles.retryText}>
                    Retry
                  </ThemedText>
                </Pressable>
              </View>
            ) : null}

            {slots && slots.length === 0 && !slotsError ? (
              <View style={styles.emptyState}>
                <ThemedText type="body" themeColor="inkSecondary" style={styles.emptyText}>
                  No upcoming slots for this service.
                </ThemedText>
              </View>
            ) : null}

            {slots?.map((slot) => {
              const mine = findMine(slot);
              const busy = pendingId === slot.id || (!!mine && pendingId === mine.id);
              const canCheckIn = mine ? isCheckInWindow(new Date(slot.starts_at), new Date()) : false;

              return (
                <View key={slot.id} style={[styles.slotCard, CardShadow, { borderColor: theme.hairline, backgroundColor: theme.surface }]}>
                  <ThemedText type="bodyLg">{formatSlot(slot.starts_at)}</ThemedText>

                  {mine ? (
                    <View style={styles.actions}>
                      {canCheckIn ? (
                        <Pressable
                          disabled={busy}
                          onPress={() => handleCheckIn(mine)}
                          style={[styles.button, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}>
                          {busy ? (
                            <ActivityIndicator color={theme.onPrimary} />
                          ) : (
                            <ThemedText type="button" themeColor="onPrimary">
                              Check in
                            </ThemedText>
                          )}
                        </Pressable>
                      ) : null}
                      <Pressable
                        disabled={busy}
                        onPress={() => handleCancel(mine)}
                        style={[styles.buttonOutline, { borderColor: theme.primaryOutline, opacity: busy ? 0.6 : 1 }]}>
                        {busy && !canCheckIn ? (
                          <ActivityIndicator color={theme.ink} />
                        ) : (
                          <ThemedText type="button" themeColor="ink">
                            Cancel
                          </ThemedText>
                        )}
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      disabled={busy}
                      onPress={() => handleBook(slot)}
                      style={[styles.button, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}>
                      {busy ? (
                        <ActivityIndicator color={theme.onPrimary} />
                      ) : (
                        <ThemedText type="button" themeColor="onPrimary">
                          Book
                        </ThemedText>
                      )}
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  title: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  list: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  spinner: { marginTop: Spacing.lg },
  banner: { borderRadius: Rounded.md, padding: Spacing.md, gap: Spacing.xs, borderLeftWidth: 3 },
  retryLink: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  retryText: { textDecorationLine: 'underline' },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl },
  emptyText: { textAlign: 'center' },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  backRow: { minHeight: 44, justifyContent: 'center' },
  serviceTitle: { marginBottom: Spacing.xs },
  slotCard: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  actions: { flexDirection: 'row', gap: Spacing.xs },
  button: {
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOutline: {
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
