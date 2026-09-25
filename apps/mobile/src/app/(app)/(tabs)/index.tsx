import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedHeading } from '@/components/AnimatedHeading';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { useLiveRefresh } from '@/lib/use-live-refresh';

// Same set `my-tokens.tsx` lists in full — this screen only needs the count for a quick
// "N active" hint on the button, not the rows themselves.
const ACTIVE_STATUSES = ['pending_payment', 'waiting', 'called', 'serving'];

type ActionItem = {
  key: string;
  title: string;
  subtitle: string;
  route: '/(app)/take-token' | '/(app)/my-tokens' | '/(app)/claim-ticket' | '/(app)/name-entry';
};

// Mirrors the web `/my` action set (take token, my active tokens, claim a paper ticket, book
// appointment, profile) — `apps/web/src/app/my/page.tsx` is still a placeholder there (see
// docs/qa's Phase 1 report, bug #5: "/my has zero action buttons"), so mobile is first to ship
// this set. "Take a token" and "Book appointment" land on the same service picker: department
// screen already offers both a walk-in "Any available" token and per-doctor booking from one
// place — see take-token.tsx's own header comment.
const ACTIONS: ActionItem[] = [
  { key: 'take-token', title: 'Take a token', subtitle: 'Join the walk-in queue for a department', route: '/(app)/take-token' },
  { key: 'book-appointment', title: 'Book appointment', subtitle: 'Pick a doctor and a time slot', route: '/(app)/take-token' },
  { key: 'my-tokens', title: 'My active tokens', subtitle: 'See where you stand in the queue', route: '/(app)/my-tokens' },
  { key: 'claim-ticket', title: 'Add my paper ticket', subtitle: 'Link a desk-issued ticket to your account', route: '/(app)/claim-ticket' },
  { key: 'profile', title: 'Profile', subtitle: 'Your details on file with the hospital', route: '/(app)/name-entry' },
];

export default function Home() {
  const theme = useTheme();
  const router = useRouter();
  const [activeCount, setActiveCount] = useState<number | null>(null);

  const refetchActiveCount = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession();
    const patientId = auth.session?.user.id;
    if (!patientId) return;

    const { count } = await supabase
      .from('tokens')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .in('status', ACTIVE_STATUSES);
    setActiveCount(count ?? 0);
  }, []);

  useLiveRefresh(refetchActiveCount, 10_000);

  return (
    <ThemedView type="canvas" style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <AnimatedHeading text="HOME" accent="HOME" />
          <ThemeToggle />
        </View>
        <ThemedText type="body" themeColor="inkSecondary" style={styles.subtitle}>
          What would you like to do?
        </ThemedText>

        <ScrollView contentContainerStyle={styles.list}>
          {ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              onPress={() => router.push(action.route)}
              style={({ pressed }) => [
                styles.card,
                CardShadow,
                { backgroundColor: theme.surface, borderColor: theme.hairline, opacity: pressed ? 0.85 : 1 },
              ]}>
              <View style={styles.cardText}>
                <ThemedText type="headingMd">{action.title}</ThemedText>
                <ThemedText type="bodySm" themeColor="inkSecondary">
                  {action.key === 'my-tokens' && activeCount != null
                    ? activeCount > 0
                      ? `${activeCount} active right now`
                      : 'None right now'
                    : action.subtitle}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg },
  header: { marginTop: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  subtitle: { marginTop: Spacing.xxs, marginBottom: Spacing.md },
  list: { paddingBottom: Spacing.xl, gap: Spacing.md },
  card: {
    borderWidth: 1,
    borderRadius: Rounded.lg,
    padding: Spacing.lg,
    minHeight: 44,
  },
  cardText: { gap: Spacing.xxs },
});
