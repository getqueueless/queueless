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

// apps/api/app/routes/ai.py landed after this screen's first draft, with a slightly different
// shape than this session's own proposed docs/API_CONTRACT.md draft — reconciled against the
// real route source just now: org_id comes from the caller's authenticated profile server-side,
// never from the request body (AskIn/SummaryRunIn both use pydantic `extra="forbid"`, so a
// stray org_id field would 422, not just be ignored). /admin/ask returns {answer, ai_generated,
// function, params, rows} (no "chart" field — that was this screen's own earlier guess).
// /admin/summary's field is `report`, not `summary`, and carries no timestamp. /admin/summary/run
// runs synchronously and returns the full summary object immediately, not a 202/"started" ack.
type AskResponse = { answer: string; ai_generated: boolean; function: string | null; rows: unknown };
type SummaryResponse = { org_id: string; day: string; report: string; ai_generated: boolean; aggregates: unknown };

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

// `rows` comes straight from a Postgres analytics.* function via asyncpg — its shape varies per
// function (no_shows_by_service vs avg_wait_by_hour vs busiest_counters all return different
// columns), so this renders it generically as one line per row rather than assuming a specific
// {label, value} pair per function.
function RowsList({ rows, functionName }: { rows: unknown; functionName: string | null }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <View style={styles.chart}>
      {functionName ? (
        <ThemedText type="caption" themeColor="inkMuted">
          Based on: {functionName}
        </ThemedText>
      ) : null}
      {rows.map((row, i) => (
        <ThemedText key={i} type="caption" themeColor="inkSecondary" style={styles.rowLine}>
          {typeof row === 'object' && row !== null
            ? Object.entries(row as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')
            : String(row)}
        </ThemedText>
      ))}
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
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        // No org_id query param — require_org_role resolves it server-side from the caller's
        // own authenticated profile, so this call needs the Authorization header, not a param.
        const res = await fetch(`${apiUrl}/admin/summary`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
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
      // No org_id in the body — AskIn (apps/api/app/routes/ai.py) is pydantic
      // `extra="forbid"` with only `question`; org comes from the caller's own profile
      // server-side. A stray org_id field would 422, not just be ignored.
      const res = await fetch(`${apiUrl}/admin/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ question: q }),
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
      // No org_id in the body (SummaryRunIn only takes an optional `day`, same
      // extra="forbid" reasoning as /admin/ask) — and this runs synchronously (a real
      // DeepSeek call + DB write), not a 202/"started" background job, so the response
      // body IS the finished summary. A generous timeout to match.
      const res = await fetch(`${apiUrl}/admin/summary/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        setGenerateMessage(NOT_AVAILABLE);
        return;
      }
      const body = (await res.json()) as SummaryResponse;
      setSummary(body);
      setSummaryError(null);
      setGenerateMessage(body.ai_generated ? 'Generated.' : 'Generated (AI was unavailable — plain aggregates only).');
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
              {askResult.ai_generated ? <AiBadge /> : null}
              <ThemedText type="body" style={styles.answerText}>
                {askResult.answer}
              </ThemedText>
              <RowsList rows={askResult.rows} functionName={askResult.function} />
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
                {summary.ai_generated ? <AiBadge /> : null}
                <ThemedText type="body" style={styles.answerText}>
                  {summary.report}
                </ThemedText>
                <ThemedText type="caption" themeColor="inkMuted">
                  {summary.day}
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
  rowLine: { paddingVertical: 2 },
  generateButton: {
    minHeight: 44,
    borderRadius: Rounded.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
});
