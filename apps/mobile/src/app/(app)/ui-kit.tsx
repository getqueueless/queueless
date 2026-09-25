// Hidden dev screen: every component in '@/components/ui', in both themes (flip the toggle).
// Not linked from anywhere; open /ui-kit.
import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemeToggle } from '@/components/ThemeToggle';
import { ThemedView } from '@/components/themed-view';
import {
  Button,
  Card,
  DeptTile,
  DoctorCard,
  EmptyState,
  SectionHeader,
  Skeleton,
  StatusChip,
  StickyBottomBar,
  UIText,
  useStickyBottomBarHeight,
  type ChipStatus,
} from '@/components/ui';

const DEPTS = ['General OPD', 'Orthopedics', 'Pharmacy', 'Pediatrics', 'Cardiology', 'ENT'];
const CHIPS: ChipStatus[] = ['available', 'late', 'leave', 'paid', 'pending', 'refunded'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <UIText variant="secondaryStrong" color="inkSecondary">
        {title}
      </UIText>
      {children}
    </View>
  );
}

export default function UiKit() {
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(12);
  const barHeight = useStickyBottomBarHeight();

  return (
    <ThemedView type="canvasSoft" style={styles.flex}>
      <Stack.Screen options={{ title: 'UI kit' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: barHeight + 32 }]}>
        <View style={styles.row}>
          <UIText variant="title1">UI kit</UIText>
          <ThemeToggle />
        </View>

        <Section title="Type">
          <UIText variant="title1">Title 34</UIText>
          <UIText variant="title2">Title 28</UIText>
          <UIText variant="title3">Title 22</UIText>
          <UIText>Body 17 — your token is confirmed.</UIText>
          <UIText variant="secondary">Secondary 15 — the smallest size in the kit.</UIText>
        </Section>

        <Section title="Button">
          <Button
            label="Book & pay ₹300"
            block
            loading={loading}
            onPress={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1500);
            }}
          />
          <View style={styles.wrap}>
            <Button label="Primary" size="md" />
            <Button label="Secondary" size="md" variant="secondary" />
            <Button label="Ghost" size="md" variant="ghost" />
            <Button label="Cancel token" size="md" variant="danger" />
          </View>
          <View style={styles.wrap}>
            <Button label="Directions" variant="secondary" icon={{ ios: 'map', android: 'map', web: 'map' }} />
            <Button label="Disabled" disabled />
          </View>
        </Section>

        <Section title="Card">
          <Card onPress={() => {}} accessibilityLabel="Your token OPD-042">
            <UIText variant="title3">OPD-042</UIText>
            <UIText variant="secondary">General OPD · press and hold to see the 0.98 scale</UIText>
          </Card>
          <Card>
            <UIText>A static card has no press state.</UIText>
          </Card>
        </Section>

        <Section title="DeptTile">
          <View style={styles.grid}>
            {DEPTS.map((d, i) => (
              <View key={d} style={styles.cell}>
                <DeptTile name={d} waitMinutes={i === 0 ? wait : i === 2 ? 0 : i === 5 ? null : 8 + i * 5} onPress={() => {}} />
              </View>
            ))}
          </View>
          <Button label="Change OPD wait" size="md" variant="secondary" onPress={() => setWait((w) => (w === 12 ? 17 : 12))} />
        </Section>

        <Section title="DoctorCard">
          <DoctorCard
            name="Dr. Asha Rao"
            department="General OPD"
            feeInr={300}
            status="available"
            nextSlot="Today, 11:30 AM"
            onAction={() => {}}
            onPress={() => {}}
          />
          <DoctorCard name="Dr. Vikram Singh" department="Orthopedics" feeInr={500} status="late" nextSlot="Today, 12:10 PM" actionLabel="Take token" />
          <DoctorCard name="Dr. Meera Iyer" department="Pediatrics" feeInr={0} status="leave" />
        </Section>

        <Section title="SectionHeader">
          <SectionHeader title="Your tokens" action={{ label: 'See all', onPress: () => {} }} />
          <SectionHeader title="Departments" />
        </Section>

        <Section title="Skeleton">
          <Card>
            <View style={styles.skeletonRow} accessible accessibilityLabel="Loading doctor">
              <Skeleton width={56} height={56} radius={28} />
              <View style={styles.skeletonText}>
                <Skeleton width="70%" height={18} />
                <Skeleton width="45%" height={14} />
              </View>
            </View>
            <Skeleton height={48} radius={12} />
          </Card>
        </Section>

        <Section title="EmptyState">
          <Card>
            <EmptyState
              icon={{ ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' }}
              title="No tokens yet"
              text="Take a token for any department and it will show up here with a live wait."
              action={{ label: 'Take a token', onPress: () => {} }}
            />
          </Card>
        </Section>

        <Section title="StatusChip">
          <View style={styles.wrap}>
            {CHIPS.map((s) => (
              <StatusChip key={s} status={s} />
            ))}
          </View>
        </Section>
      </ScrollView>
      <StickyBottomBar total="₹300" cta="Pay & confirm" onPress={() => {}} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 20, gap: 32 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  section: { gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '47%', flexGrow: 1 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  skeletonText: { flex: 1, gap: 8 },
});
