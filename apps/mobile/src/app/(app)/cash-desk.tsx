import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChipRow } from '@/components/admin/controls';
import { LabeledInput } from '@/components/admin/labeled-input';
import { StateCard } from '@/components/admin/state-card';
import { ThemedView } from '@/components/themed-view';
import { Button, Card, MIN_TAP, Radius, UIText } from '@/components/ui';
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
type DoctorOption = {
  id: string;
  name: string;
  service_id: string;
  fee_inr: number;
};
type Receipt = {
  id: string;
  receipt_no: string;
  amount_inr: number;
  created_at: string;
  refund_of: string | null;
};

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

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

export default function CashDesk() {
  const insets = useSafeAreaInsets();
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
  const [issued, setIssued] = useState<{ code: string; cash: boolean } | null>(null);

  const refetch = useCallback(async () => {
    if (!orgId) return;
    const [svcRes, docRes, cashRes] = await Promise.all([
      supabase.from('services').select('id, name, is_open').eq('org_id', orgId).order('name'),
      supabase
        .from('doctors')
        .select('id, name, service_id, fee_inr')
        .eq('org_id', orgId)
        .eq('active', true)
        .order('name'),
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
    if (cash && override !== null && (!Number.isInteger(override) || override < 0))
      return setError('Amount must be whole rupees, 0 or more.');

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

    setIssued({ code: data?.code ?? '', cash });
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

  const ready = !!orgId && !loadError;

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {/* Keeps the pinned Issue ticket bar above the iOS number pad; offset = stack header. */}
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 44}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {!orgId ? (
              <StateCard kind="error" message="No organization assigned to this account." />
            ) : loadError ? (
              <StateCard kind="error" message={loadError} />
            ) : (
              <>
                <Card>
                  <UIText variant="title3" accessibilityRole="header">
                    New walk-in
                  </UIText>
                  <LabeledInput
                    label="Patient name"
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                    style={styles.field}
                  />
                  <LabeledInput
                    label="Mobile number (10 digits)"
                    value={phone}
                    onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                    keyboardType="phone-pad"
                    style={styles.field}
                  />
                  <UIText variant="secondaryStrong" color="inkSecondary">
                    Gender (optional)
                  </UIText>
                  <ChipRow options={GENDERS} value={gender} onChange={setGender} />
                  <View style={styles.pair}>
                    <View style={styles.flex}>
                      <LabeledInput
                        label="Date of birth (optional)"
                        value={dob}
                        onChangeText={setDob}
                        placeholder="YYYY-MM-DD"
                        maxLength={10}
                        style={styles.field}
                      />
                    </View>
                    <View style={styles.flex}>
                      <LabeledInput label="City (optional)" value={city} onChangeText={setCity} style={styles.field} />
                    </View>
                  </View>
                </Card>

                <Card>
                  <UIText variant="title3" accessibilityRole="header">
                    Visit
                  </UIText>
                  <UIText variant="secondaryStrong" color="inkSecondary">
                    Department
                  </UIText>
                  <ChipRow
                    options={(services ?? []).map((s) => ({
                      value: s.id,
                      label: s.is_open ? s.name : `${s.name} (closed)`,
                    }))}
                    value={serviceId}
                    onChange={pickService}
                  />
                  {serviceId && serviceDoctors.length > 0 ? (
                    <>
                      <UIText variant="secondaryStrong" color="inkSecondary">
                        Doctor
                      </UIText>
                      <ChipRow
                        options={[
                          { value: ANY_DOCTOR, label: 'Any doctor' },
                          ...serviceDoctors.map((d) => ({
                            value: d.id,
                            label: `${d.name} · ${inr(d.fee_inr)}`,
                          })),
                        ]}
                        value={doctorId}
                        onChange={pickDoctor}
                      />
                    </>
                  ) : null}
                  <UIText variant="secondaryStrong" color="inkSecondary">
                    Lane
                  </UIText>
                  <ChipRow options={LANES} value={lane} onChange={setLane} />
                </Card>

                <Card>
                  {/* The whole row is the switch's tap target; the native Switch is under 48pt. */}
                  <Pressable
                    onPress={() => setCash(!cash)}
                    accessibilityRole="switch"
                    accessibilityLabel="Cash received"
                    accessibilityState={{ checked: cash }}
                    style={styles.switchRow}>
                    <View style={styles.flex}>
                      <UIText variant="bodyStrong">Cash received</UIText>
                      <UIText variant="secondary">
                        {cash ? 'A receipt is written with the ticket' : 'Ticket only, no receipt'}
                      </UIText>
                    </View>
                    <View
                      pointerEvents="none"
                      importantForAccessibility="no-hide-descendants"
                      accessibilityElementsHidden>
                      <Switch
                        value={cash}
                        onValueChange={setCash}
                        trackColor={{
                          false: theme.hairline,
                          true: theme.primaryOutline,
                        }}
                        thumbColor={cash ? theme.primary : theme.surface}
                      />
                    </View>
                  </Pressable>
                  {cash ? (
                    <LabeledInput
                      label="Amount (₹) — blank uses the doctor's fee"
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="number-pad"
                      style={styles.field}
                    />
                  ) : null}
                </Card>

                <Card>
                  <View style={styles.totalHead}>
                    <UIText variant="secondaryStrong" color="inkSecondary">
                      My cash today
                    </UIText>
                    <UIText variant="secondary">
                      {receipts.length} receipt
                      {receipts.length === 1 ? '' : 's'}
                    </UIText>
                  </View>
                  <UIText variant="title1" color={total < 0 ? 'danger' : 'ink'}>
                    {inr(total)}
                  </UIText>
                  {receipts.length === 0 ? (
                    <UIText variant="secondary">No receipts yet today.</UIText>
                  ) : (
                    receipts.map((r) => (
                      <View key={r.id} style={[styles.receipt, { borderTopColor: theme.hairline }]}>
                        <View style={styles.flex}>
                          <UIText variant="bodyStrong">{r.receipt_no}</UIText>
                          <UIText variant="secondary">
                            {timeOf(r.created_at)}
                            {r.refund_of ? ' · refund' : ''}
                          </UIText>
                        </View>
                        <UIText variant="bodyStrong" color={r.amount_inr < 0 ? 'danger' : 'ink'}>
                          {inr(r.amount_inr)}
                        </UIText>
                      </View>
                    ))
                  )}
                </Card>
              </>
            )}
          </ScrollView>

          {ready ? (
            // Thumb zone: result + the one action a counter clerk taps, pinned under the form.
            <View
              style={[
                styles.bar,
                {
                  backgroundColor: theme.surface,
                  borderTopColor: theme.hairline,
                },
              ]}>
              {error ? (
                <UIText variant="secondaryStrong" color="danger" accessibilityLiveRegion="polite">
                  {error}
                </UIText>
              ) : null}
              {issued ? (
                <View
                  style={[styles.issued, { backgroundColor: theme.successSoft }]}
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={`Ticket ${issued.code} issued${issued.cash ? ', cash recorded' : ''}`}>
                  <UIText variant="secondaryStrong" color="success">
                    Ticket issued{issued.cash ? ' · cash recorded' : ''}
                  </UIText>
                  <UIText variant="title1" color="success">
                    {issued.code}
                  </UIText>
                </View>
              ) : null}
              <Button
                label="Issue ticket"
                icon={{
                  ios: 'ticket',
                  android: 'confirmation_number',
                  web: 'confirmation_number',
                }}
                onPress={register}
                loading={busy}
                block
              />
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.lg },
  field: { minHeight: MIN_TAP, fontSize: 17 },
  pair: { flexDirection: 'row', gap: Spacing.xs },
  flex: { flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 56,
  },
  totalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  receipt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 56,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bar: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    gap: Spacing.xs,
    borderTopWidth: 1,
  },
  issued: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    alignItems: 'center',
  },
});
