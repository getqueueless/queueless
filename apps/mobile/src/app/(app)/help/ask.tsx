import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInUp, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Type, UIText } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { askQueueless } from '@/lib/help-api';
import { getLanguagePreference } from '@/lib/language-preference';

type NewMessage =
  | { from: 'you'; text: string }
  | { from: 'queueless'; text: string; basedOn: { id: string; question: string }[] }
  | { from: 'system'; text: string };
type Message = NewMessage & { id: number };

const SUGGESTIONS = ['How do I take a token?', 'When do I get a refund?', 'What does priority mean?'];

/** Ask Queueless: a chat-style help screen over POST /help/ask, answering in the app's language. */
export default function AskQueueless() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const params = useLocalSearchParams<{ q?: string }>();
  const [draft, setDraft] = useState(params.q ?? '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const scroller = useRef<ScrollView>(null);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const push = (m: NewMessage) => setMessages((list) => [...list, { ...m, id: nextId.current++ }]);
    push({ from: 'you', text: question });
    setDraft('');
    setBusy(true);
    const result = await askQueueless(question, getLanguagePreference());
    setBusy(false);
    if (result.ok) {
      push({ from: 'queueless', text: result.data.answer || 'I don’t have an answer for that yet.', basedOn: result.data.basedOn });
    } else if (result.kind === 'rate_limited') {
      push({
        from: 'system',
        text: `You’re asking a little fast. Try again${result.retryAfter ? ` in ${Math.ceil(result.retryAfter)} seconds` : ' in a moment'}.`,
      });
    } else {
      push({ from: 'system', text: result.message });
    }
  }

  const entering = reduceMotion ? undefined : FadeInUp.duration(220);

  return (
    <ThemedView type="canvasSoft" style={styles.flex}>
      <Stack.Screen options={{ title: 'Ask Queueless' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: !reduceMotion })}
          keyboardShouldPersistTaps="handled">
          {messages.length === 0 ? (
            <View style={styles.intro}>
              <UIText variant="title2">Ask Queueless</UIText>
              <UIText color="inkSecondary">
                Questions about tokens, appointments, payments or your visit. Answers come from the hospital’s help pages.
              </UIText>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => send(s)}
                    accessibilityRole="button"
                    style={[styles.suggestion, { backgroundColor: theme.primarySoft }]}>
                    <UIText variant="secondaryStrong" color="primaryText">
                      {s}
                    </UIText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {messages.map((m) =>
            m.from === 'you' ? (
              <Animated.View key={m.id} entering={entering} style={[styles.bubble, styles.mine, { backgroundColor: theme.primary }]}>
                <UIText style={{ color: theme.onPrimary }}>{m.text}</UIText>
              </Animated.View>
            ) : m.from === 'system' ? (
              <Animated.View key={m.id} entering={entering} accessibilityLiveRegion="polite" style={[styles.system, { backgroundColor: theme.warningSoft }]}>
                <UIText variant="secondary" color="warning">
                  {m.text}
                </UIText>
              </Animated.View>
            ) : (
              <Animated.View
                key={m.id}
                entering={entering}
                accessibilityLiveRegion="polite"
                style={[styles.bubble, styles.theirs, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
                <UIText>{m.text}</UIText>
                {m.basedOn.length > 0 ? (
                  <View style={styles.sources}>
                    <UIText variant="secondaryStrong" color="inkSecondary">
                      Based on
                    </UIText>
                    {m.basedOn.map((s) => (
                      <Pressable
                        key={s.id}
                        onPress={() => router.push({ pathname: '/(app)/help/faq', params: { open: s.id } } as Href)}
                        accessibilityRole="link"
                        style={styles.source}>
                        <SymbolView name={{ ios: 'doc.text', android: 'article', web: 'article' }} size={16} tintColor={theme.primaryText} />
                        <UIText variant="secondary" color="primaryText" style={styles.flex}>
                          {s.question}
                        </UIText>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </Animated.View>
            ),
          )}

          {busy ? (
            <View style={[styles.bubble, styles.theirs, { backgroundColor: theme.surface, borderColor: theme.hairline }]} accessibilityLabel="Queueless is answering">
              <UIText color="inkSecondary">Thinking…</UIText>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12), backgroundColor: theme.surface, borderTopColor: theme.hairline }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type your question"
            placeholderTextColor={theme.inkMuted}
            accessibilityLabel="Your question"
            style={[styles.input, Type.body, { color: theme.ink, backgroundColor: theme.canvasSoft, borderColor: theme.hairline }]}
            multiline
            maxLength={500}
            onSubmitEditing={() => send(draft)}
            blurOnSubmit
            returnKeyType="send"
          />
          <Pressable
            onPress={() => send(draft)}
            disabled={!draft.trim() || busy}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={[styles.send, { backgroundColor: theme.primary, opacity: !draft.trim() || busy ? 0.45 : 1 }]}>
            <SymbolView name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }} size={22} tintColor={theme.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  thread: { padding: 16, gap: 12, paddingBottom: 24 },
  intro: { gap: 12, paddingVertical: 8 },
  suggestions: { gap: 8, alignItems: 'flex-start' },
  suggestion: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 24 },
  bubble: { maxWidth: '86%', borderRadius: 20, paddingVertical: 12, paddingHorizontal: 16, gap: 10 },
  mine: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', borderWidth: 1, borderBottomLeftRadius: 6 },
  system: { alignSelf: 'center', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, maxWidth: '92%' },
  sources: { gap: 4 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 10, paddingHorizontal: 12, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderWidth: 1, borderRadius: 24, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
