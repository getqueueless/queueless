import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, ChipRow, PrimaryButton } from '@/components/admin/controls';
import { LabeledInput } from '@/components/admin/labeled-input';
import { StateCard } from '@/components/admin/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isDate } from '@/lib/admin-doctors';
import { mapSupabaseError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Staff desk for walk-ins who pay cash (supabase/migrations/0041_cash_desk.sql). One RPC,
// staff_register_walkin, mints the ticket and — only when cash was taken — writes the receipt
// in the same transaction; the amount falls back to the doctor's fee server-side. Receipts are
// append-only, so this screen never edits one; refunds are an admin-only RPC.

type Gender = 'female' | 'male' | 'other' | 'prefer_not';
type Lane = 'normal' | 'senior' | 'pregnant' | 'emergency';
type Service = { id: string; name: string; is_open: boolean };
type DoctorOption = { id: string; name: string; service_id: string; fee_inr: number };
type Receipt = { id: string; receipt_no: string; amount_inr: number; created_at: string; refund_of: string | null };

const GENDERS: { value: Gender; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not', label: 'Prefer not to say' },
];
const LANES: { value: Lane; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'senior', label: 'Senior' },
  { value: 'pregnant', label: 'Pregnant' },
  { value: 'emergency', label: 'Emergency' },
];
const ANY_DOCTOR = '';

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export default function CashDesk() {
  const theme = useTheme();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);

  const [services, setServices] = useState<Service[] | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [dob, setDob] = useState('');
  const [city, setCity] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [doctorId, setDoctorId] = useState<string>(ANY_DOCTOR);
  const [lane, setLane] = useState<Lane>('normal');
  const [cash, setCash] = useState(true);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    const [svcRes, docRes, cashRes] = await Promise.all([
      supabase.from('services').select('id, name, is_open').eq('org_id', orgId).order('name'),
      supabase.from('doctors').select('id, name, service_id, fee_inr').eq('org_id', orgId).eq('active', true).order('name'),
      supabase.rpc('my_cash_today'),
    ]);
    const firstError = svcRes.error ?? docRes.error ?? cashRes.error;
    if (firstError) {
      setLoadError(mapSupabaseError(firstError));
      return;
    }
    setLoadError(null);
    setServices((svcRes.data ?? []) as Service[]);
    setDoctors((docRes.data ?? []) as DoctorOption[]);
    setReceipts((cashRes.data ?? []) as Receipt[]);
  }, [orgId]);
  useLiveRefresh(refetch);

  const serviceDoctors = doctors.filter((d) => d.service_id === serviceId);
  const total = receipts.reduce((sum, r) => sum + r.amount_inr, 0);

  function pickService(id: string) {
    setServiceId(id);
    setDoctorId(ANY_DOCTOR);
    setAmount('');
  }

  function pickDoctor(id: string) {
    setDoctorId(id);
    const fee = doctors.find((d) => d.id === id)?.fee_inr;
    setAmount(fee !== undefined ? String(fee) : '');
  }

  async function register() {
    const digits = phone.replace(/\D/g, '');
    if (!name.trim()) return setError('Enter the patient’s name.');
    if (!/^[6-9]\d{9}$/.test(digits)) return setError('Enter a 10-digit Indian mobile number.');
    if (dob && !isDate(dob)) return setError('Date of birth must look like 1990-05-21.');
    if (!serviceId) return setError('Pick a department.');
    const override = amount.trim() === '' ? null : Number(amount);
    if (cash && override !== null && (!Number.isInteger(override) || override < 0)) return setError('Amount must be whole rupees, 0 or more.');

    setBusy(true);
    setError(null);
    setIssued(null);
    const { data, error: rpcError } = await supabase.rpc('staff_register_walkin', {
      p_full_name: name.trim(),
      p_phone: `+91${digits}`,
      p_date_of_birth: dob || null,
      p_gender: gender,
      p_city: city.trim() || null,
      p_service_id: serviceId,
      p_doctor_id: doctorId || null,
      p_lane: lane,
      p_cash_received: cash,
      p_amount_override: cash ? override : null,
    });
    setBusy(false);
    if (rpcError) return setError(mapSupabaseError(rpcError));

    setIssued(`Ticket ${data?.code ?? ''} issued${cash ? ' · cash recorded' : ''}.`);
    setName('');
    setPhone('');
    setGender(null);
    setDob('');
    setCity('');
    setLane('normal');
    refetch();
  }

  if (roleLoading || (orgId && services === null && !loadError)) {
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
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!orgId ? (
            <StateCard kind="error" message="No organization assigned to this account." />
          ) : loadError ? (
            <StateCard kind="error" message={loadError} />
          ) : (
            <>
              <Card>
                <ThemedText type="headingSm">New walk-in</ThemedText>
                <LabeledInput label="Patient name" value={name} onChangeText={setName} autoCapitalize="words" />
                <LabeledInput
                  label="Mobile number (10 digits)"
                  value={phone}
                  onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="phone-pad"
                />
                <ThemedText type="caption" themeColor="inkMuted">
                  Gender (optional)
                </ThemedText>
                <ChipRow options={GENDERS} value={gender} onChange={setGender} />
                <View style={styles.pair}>
                  <View style={styles.flex}>
                    <LabeledInput label="Date of birth (optional)" value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" maxLength={10} />
                  </View>
                  <View style={styles.flex}>
                    <LabeledInput label="City (optional)" value={city} onChangeText={setCity} />
                  </View>
                </View>

                <ThemedText type="caption" themeColor="inkMuted">
                  Department
                </ThemedText>
                <ChipRow
                  options={(services ?? []).map((s) => ({ value: s.id, label: s.is_open ? s.name : `${s.name} (closed)` }))}
                  value={serviceId}
                  onChange={pickService}
                />
                {serviceId && serviceDoctors.length > 0 ? (
                  <>
                    <ThemedText type="caption" themeColor="inkMuted">
                      Doctor
                    </ThemedText>
                    <ChipRow
                      options={[{ value: ANY_DOCTOR, label: 'Any doctor' }, ...serviceDoctors.map((d) => ({ value: d.id, label: `${d.name} · ₹${d.fee_inr}` }))]}
                      value={doctorId}
                      onChange={pickDoctor}
                    />
                  </>
                ) : null}
                <ThemedText type="caption" themeColor="inkMuted">
                  Lane
                </ThemedText>
                <ChipRow options={LANES} value={lane} onChange={setLane} />

                <View style={styles.switchRow}>
                  <ThemedText type="body">Cash received</ThemedText>
                  <Switch
                    value={cash}
                    onValueChange={setCash}
                    trackColor={{ false: theme.hairline, true: theme.primaryOutline }}
                    thumbColor={cash ? theme.primary : theme.surface}
                  />
                </View>
                {cash ? (
                  <LabeledInput
                    label="Amount (₹) — blank uses the doctor's fee"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="number-pad"
                  />
                ) : null}

                {error ? (
                  <ThemedText type="bodySm" themeColor="danger">
                    {error}
                  </ThemedText>
                ) : null}
                {issued ? (
                  <ThemedText type="bodySm" themeColor="success">
                    {issued}
                  </ThemedText>
                ) : null}
                <PrimaryButton label="Issue ticket" onPress={register} busy={busy} />
              </Card>

              <Card>
                <View style={styles.switchRow}>
                  <ThemedText type="headingSm">My cash today</ThemedText>
                  <ThemedText type="headingSm">₹{total}</ThemedText>
                </View>
                {receipts.length === 0 ? (
                  <ThemedText type="bodySm" themeColor="inkMuted">
                    No receipts yet today.
                  </ThemedText>
                ) : (
                  receipts.map((r) => (
                    <View key={r.id} style={styles.switchRow}>
                      <ThemedText type="bodySm" themeColor="inkSecondary">
                        {r.receipt_no} · {timeOf(r.created_at)}
                        {r.refund_of ? ' · refund' : ''}
                      </ThemedText>
                      <ThemedText type="body" themeColor={r.amount_inr < 0 ? 'danger' : 'ink'}>
                        ₹{r.amount_inr}
                      </ThemedText>
                    </View>
                  ))
                )}
              </Card>
            </>
          )}
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  pair: { flexDirection: 'row', gap: Spacing.xs },
  flex: { flex: 1 },
});
