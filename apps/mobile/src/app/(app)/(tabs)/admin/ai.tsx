import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Rounded, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import { useRole } from '@/lib/use-role';
import { useSession } from '@/lib/use-session';

// Neither /admin/ask nor /admin/summary/run exists in apps/api yet (checked
// apps/api/app/routes/admin.py on origin/main just now — only /admin/model and /admin/retrain
// are live). This screen is built against the contract this session just wrote and appended to
// docs/API_CONTRACT.md, with real fetch calls — every call 404s right now, handled as an honest
// "Not available yet" state, not mocked data. Nothing else needs to change here once apps/api
// implements the contract.
type AskChart = { labels: string[]; values: number[] };
type AskResponse = { answer: string; chart: AskChart | null };
type SummaryResponse = { generated_at: string; summary: string };

const NOT_AVAILABLE = 'Not available yet — apps/api hasn’t implemented this endpoint.';

function AiBadge() {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.primarySoft, borderColor: theme.primaryOutline }]}>
      <ThemedText type="caption" themeColor="primaryText">
        AI-generated
      </ThemedText>
    </View>
  );
}

function BarChart({ chart }: { chart: AskChart }) {
  const theme = useTheme();
  const max = Math.max(1, ...chart.values);
  return (
    <View style={styles.chart}>
      {chart.labels.map((label, i) => {
        const value = chart.values[i] ?? 0;
        return (
          <View key={label} style={styles.chartRow}>
            <ThemedText type="caption" themeColor="inkSecondary" style={styles.chartLabel} numberOfLines={1}>
              {label}
            </ThemedText>
            <View style={styles.chartTrack}>
              <View style={[styles.chartBar, { backgroundColor: theme.primary, width: `${(value / max) * 100}%` }]} />
            </View>
            <ThemedText type="caption" themeColor="inkMuted">
              {value}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

export default function AdminAsk() {
  const theme = useTheme();
  const { session } = useSession();
  const { orgId, loading: roleLoading } = useRole(session?.user?.id);
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<AskResponse | null>(null);

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);

  // One-shot GET on mount — no natural Realtime channel for a server-generated daily summary.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      if (!apiUrl) {
        setSummaryLoading(false);
        return;
      }
      setSummaryLoading(true);
      try {
        const res = await fetch(`${apiUrl}/admin/summary?org_id=${encodeURIComponent(orgId)}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (cancelled) return;
        if (res.status === 404 || res.status === 204) {
          setSummary(null);
          setSummaryError(null);
        } else if (!res.ok) {
          setSummary(null);
          setSummaryError(NOT_AVAILABLE);
        } else {
          const body = (await res.json()) as SummaryResponse | null;
          setSummary(body);
          setSummaryError(null);
        }
      } catch {
        if (!cancelled) {
          setSummary(null);
          setSummaryError(NOT_AVAILABLE);
        }
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, apiUrl]);

  async function handleAsk() {
    const q = question.trim();
    if (!q || asking || !orgId) return;
    setAsking(true);
    setAskError(null);
    setAskResult(null);
    if (!apiUrl) {
      setAsking(false);
      setAskError(NOT_AVAILABLE);
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`${apiUrl}/admin/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ org_id: orgId, question: q }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        setAskError(NOT_AVAILABLE);
        return;
      }
      setAskResult((await res.json()) as AskResponse);
    } catch {
      setAskError(NOT_AVAILABLE);
    } finally {
      setAsking(false);
    }
  }

  async function handleGenerate() {
    if (generating || !orgId) return;
    setGenerating(true);
    setGenerateMessage(null);
    if (!apiUrl) {
      setGenerating(false);
      setGenerateMessage(NOT_AVAILABLE);
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`${apiUrl}/admin/summary/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ org_id: orgId }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        setGenerateMessage(NOT_AVAILABLE);
        return;
      }
      setGenerateMessage('Generation started — check back soon.');
    } catch {
      setGenerateMessage(NOT_AVAILABLE);
    } finally {
      setGenerating(false);
    }
  }

  if (roleLoading) {
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
        <ScrollView contentContainerStyle={styles.scroll}>
          <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
            Ask your data
          </ThemedText>
          <View style={styles.askRow}>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="e.g. Which service had the longest wait today?"
              placeholderTextColor={theme.inkMuted}
              onSubmitEditing={handleAsk}
              returnKeyType="send"
              style={[styles.askInput, { color: theme.ink, borderColor: theme.hairline }]}
            />
            <Pressable
              onPress={handleAsk}
              disabled={asking || !question.trim()}
              style={[styles.askButton, { backgroundColor: theme.dark, opacity: asking || !question.trim() ? 0.6 : 1 }]}>
              {asking ? <ActivityIndicator color={theme.onPrimary} /> : (
                <ThemedText type="button" themeColor="onPrimary">
                  Ask
                </ThemedText>
              )}
            </Pressable>
          </View>

          {askError ? (
            <ThemedText type="bodySm" themeColor="danger" style={styles.error}>
              {askError}
            </ThemedText>
          ) : null}

          {askResult ? (
            <ThemedView type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }]}>
              <AiBadge />
              <ThemedText type="body" style={styles.answerText}>
                {askResult.answer}
              </ThemedText>
              {askResult.chart ? <BarChart chart={askResult.chart} /> : null}
            </ThemedView>
          ) : null}

          <ThemedText type="headingMd" themeColor="inkSecondary" style={styles.sectionLabel}>
            Daily summary
          </ThemedText>
          <ThemedView type="surface" style={[styles.card, CardShadow, { borderColor: theme.hairline }]}>
            {summaryLoading ? (
              <ActivityIndicator color={theme.primary} />
            ) : summary ? (
              <>
                <AiBadge />
                <ThemedText type="body" style={styles.answerText}>
                  {summary.summary}
                </ThemedText>
                <ThemedText type="caption" themeColor="inkMuted">
                  Generated {new Date(summary.generated_at).toLocaleString()}
                </ThemedText>
              </>
            ) : (
              <ThemedText type="bodySm" themeColor="inkMuted">
                {summaryError ?? 'No summary has been generated yet.'}
              </ThemedText>
            )}

            {generateMessage ? (
              <ThemedText type="bodySm" themeColor={generateMessage === NOT_AVAILABLE ? 'danger' : 'success'} style={styles.error}>
                {generateMessage}
              </ThemedText>
            ) : null}

            <Pressable
              onPress={handleGenerate}
              disabled={generating}
              style={[styles.generateButton, { borderColor: theme.primaryOutline, opacity: generating ? 0.6 : 1 }]}>
              {generating ? (
                <ActivityIndicator color={theme.primaryText} />
              ) : (
                <ThemedText type="button" themeColor="primaryText">
                  Generate now
                </ThemedText>
              )}
            </Pressable>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  scroll: { paddingBottom: Spacing.xxl, gap: Spacing.xs },
  sectionLabel: { marginTop: Spacing.md },
  error: { marginTop: Spacing.xs },
  askRow: { flexDirection: 'row', gap: Spacing.xs },
  askInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Rounded.md,
    paddingHorizontal: Spacing.sm,
    minHeight: 44,
  },
  askButton: { minHeight: 44, borderRadius: Rounded.md, paddingHorizontal: Spacing.md, justifyContent: 'center' },
  card: { borderWidth: 1, borderRadius: Rounded.lg, padding: Spacing.md, gap: Spacing.xs },
  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: Rounded.pill, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  answerText: { marginTop: Spacing.xxs },
  chart: { marginTop: Spacing.xs, gap: Spacing.xxs },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  chartLabel: { width: 90 },
  chartTrack: { flex: 1, height: 10, borderRadius: Rounded.pill, backgroundColor: 'rgba(128,128,128,0.15)', overflow: 'hidden' },
  chartBar: { height: '100%', borderRadius: Rounded.pill },
  generateButton: {
    minHeight: 44,
    borderRadius: Rounded.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
});
