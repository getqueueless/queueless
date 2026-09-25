import { SymbolView } from 'expo-symbols';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DepartmentGrid, HomeHeader } from '@/components/home';
import { Card, SectionHeader, UIText, type IconName } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

type QuickAction = { key: string; label: string; icon: IconName; route: '/(app)/take-token' | '/(app)/claim-ticket' };

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'take-token', label: 'Take token', icon: { ios: 'ticket', android: 'confirmation_number', web: 'confirmation_number' }, route: '/(app)/take-token' },
  { key: 'book-appointment', label: 'Book appointment', icon: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }, route: '/(app)/take-token' },
  { key: 'claim-ticket', label: 'Claim ticket', icon: { ios: 'qrcode', android: 'qr_code', web: 'qr_code' }, route: '/(app)/claim-ticket' },
];

/**
 * Home: greeting + live token hero (both HomeHeader), a quick-action row, then the Departments
 * grid -- components/home's building blocks, composed here per the orchestrator's split (app
 * motion builds HomeHeader/DepartmentGrid, this file composes them with the rest of Home).
 * "Take token" and "Book appointment" share one destination: take-token.tsx's department picker
 * already offers both a walk-in token and per-doctor booking from the same screen.
 */
export default function Home() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeHeader />

        <View style={styles.actionRow}>
          {QUICK_ACTIONS.map((action) => (
            <Card key={action.key} onPress={() => router.push(action.route)} accessibilityLabel={action.label} style={styles.actionCard}>
              <View style={[styles.actionIcon, { backgroundColor: theme.primarySoft }]}>
                <SymbolView name={action.icon} size={22} tintColor={theme.primaryText} />
              </View>
              <UIText variant="secondaryStrong" style={styles.actionLabel} numberOfLines={2}>
                {action.label}
              </UIText>
            </Card>
          ))}
        </View>

        <SectionHeader title="Departments" />
        <DepartmentGrid />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { padding: 16, gap: 20, paddingBottom: 32 },
  actionRow: { flexDirection: 'row', gap: 12 },
  actionCard: { flex: 1, alignItems: 'center', padding: 12, gap: 8 },
  actionIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { textAlign: 'center' },
});
