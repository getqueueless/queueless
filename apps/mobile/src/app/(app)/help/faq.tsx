import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Fragment, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Button, EmptyState, Radius, Skeleton, UIText, type IconName } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fetchFaq, type FaqGroup, type FaqItem } from '@/lib/help-api';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

const CHEVRON: IconName = { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' };
const HELP_ICON: IconName = { ios: 'questionmark.circle', android: 'help', web: 'help' };

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; groups: FaqGroup[] };

// Staff and admin answers are for those roles only (the public web /faq still lists all six).
// Until the role is known, show the patient set.
const HIDDEN: Record<string, string[]> = { patient: ['Staff', 'Admin'], staff: ['Admin'], admin: [] };

export default function Faq() {
  const theme = useTheme();
  const router = useRouter();
  const { open: openParam } = useLocalSearchParams<{ open?: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const { session } = useSession();
  const { role } = useRole(session?.user?.id);
  const hidden = HIDDEN[role ?? 'patient'] ?? HIDDEN.patient;
  const [open, setOpen] = useState<Set<string>>(() => new Set(openParam ? [openParam] : []));

  const load = () =>
    fetchFaq().then(
      (groups) => setState({ status: 'ready', groups }),
      () => setState({ status: 'error' }),
    );

  useEffect(() => {
    load();
  }, []);

  const reload = () => {
    setState({ status: 'loading' });
    load();
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const q = query.trim().toLowerCase();
  const groups =
    state.status === 'ready'
      ? state.groups
          .filter((g) => !hidden.includes(g.title))
          .map((g) => ({
            ...g,
            items: g.items.filter((i) => !q || i.question.toLowerCase().includes(q) || i.answer.toLowerCase().includes(q)),
          }))
          .filter((g) => g.items.length > 0)
      : [];

  const row = (item: FaqItem) => {
    const expanded = open.has(item.id);
    return (
      <Pressable
        onPress={() => toggle(item.id)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityHint="Shows the answer"
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.surfaceSunken }]}>
        <View style={styles.rowHead}>
          <UIText variant="bodyStrong" style={styles.flex}>
            {item.question}
          </UIText>
          <SymbolView
            name={CHEVRON}
            size={18}
            tintColor={theme.inkMuted}
            style={expanded ? styles.flipped : undefined}
          />
        </View>
        {expanded ? (
          <UIText color="inkSecondary" style={styles.answer}>
            {item.answer}
          </UIText>
        ) : null}
      </Pressable>
    );
  };

  return (
    <ThemedView type="canvasSoft" style={styles.flex}>
      <Stack.Screen options={{ title: 'FAQ' }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <UIText variant="title2">Frequently asked questions</UIText>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search questions"
          placeholderTextColor={theme.inkMuted}
          accessibilityLabel="Search questions"
          clearButtonMode="while-editing"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.search, { borderColor: theme.hairline, backgroundColor: theme.surface, color: theme.ink }]}
        />

        {state.status === 'loading' ? (
          <View style={styles.skeletons} accessibilityLabel="Loading questions">
            <Skeleton height={56} radius={16} />
            <Skeleton height={56} radius={16} />
            <Skeleton height={56} radius={16} />
          </View>
        ) : state.status === 'error' ? (
          <EmptyState
            icon={HELP_ICON}
            title="FAQ isn't available right now"
            text="Please try again in a moment."
            action={{ label: 'Try again', onPress: reload }}
          />
        ) : groups.length === 0 ? (
          <View style={styles.none}>
            <UIText color="inkSecondary">No questions match “{query.trim()}”.</UIText>
            <Button
              label="Ask Queueless instead"
              variant="secondary"
              size="md"
              onPress={() => router.push({ pathname: '/(app)/help/ask', params: { q: query.trim() } } as Href)}
            />
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.title} style={styles.group}>
              <UIText variant="secondaryStrong" color="inkSecondary" style={styles.groupTitle} accessibilityRole="header">
                {g.title}
              </UIText>
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
                {g.items.map((item, i) => (
                  <Fragment key={item.id}>
                    {i > 0 ? <View style={[styles.divider, { backgroundColor: theme.hairline }]} /> : null}
                    {row(item)}
                  </Fragment>
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 48 },
  search: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    fontFamily: 'Poppins_400Regular',
    fontSize: 17,
    paddingHorizontal: 16,
  },
  skeletons: { gap: 12 },
  none: { gap: 12, alignItems: 'flex-start' },
  group: { gap: 8 },
  groupTitle: { paddingHorizontal: 4 },
  card: { borderWidth: 1, borderRadius: Radius.lg, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth },
  row: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center' },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  answer: { marginTop: 8 },
  flipped: { transform: [{ rotate: '180deg' }] },
});
