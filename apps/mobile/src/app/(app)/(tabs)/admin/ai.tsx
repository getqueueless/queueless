import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Button, Card, Radius, Skeleton, Type, UIText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
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

const UNREACHABLE = "Couldn't reach the AI service. Check your connection and try again.";

// apps/api answers errors as {"detail": "<code>"}; turn the ones it actually sends into advice.
async function aiError(res: Response): Promise<string> {
  const detail = await res.json().then((b) => b?.detail, () => null);
  if (res.status === 429) return 'Too many requests. Wait a minute and try again.';
  if (res.status === 401 || res.status === 403) return 'Only admins can use this.';
  if (detail === 'ai_unavailable') return 'AI is unavailable right now. Try again later.';
  if (res.status === 503) return "Couldn't answer that. Try rephrasing the question.";
  return UNREACHABLE;
}

// Tapping one only fills the box; the admin still presses Ask.
const EXAMPLES = ['Which service had the longest wait today?', 'No-shows by service this week', 'Busiest counters today'];

function AiBadge() {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}>
      <UIText variant="secondaryStrong" color="primaryText">
        AI-generated
      </UIText>
    </View>
  );
}

// `rows` comes straight from a Postgres analytics.* function via asyncpg — its shape varies per
// function (no_shows_by_service vs avg_wait_by_hour vs busiest_counters all return different
// columns), so this renders it generically as one line per row rather than assuming a specific
// {label, value} pair per function.
function RowsList({ rows, functionName }: { rows: unknown; functionName: string | null }) {
  const theme = useTheme();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <View style={[styles.rows, { borderColor: theme.hairline }]}>
      {functionName ? <UIText variant="secondary">Based on: {functionName}</UIText> : null}
      {rows.map((row, i) => (
        <UIText
          key={i}
          variant="secondary"
          color="ink"
          style={[styles.rowLine, i > 0 && { borderTopWidth: 1, borderColor: theme.hairline }]}>
          {typeof row === 'object' && row !== null
            ? Object.entries(row as Record<string, unknown>)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')
            : String(row)}
        </UIText>
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
          setSummaryError(await aiError(res));
        } else {
          const body = (await res.json()) as SummaryResponse | null;
          setSummary(body);
          setSummaryError(null);
        }
      } catch {
        if (!cancelled) {
          setSummary(null);
          setSummaryError(UNREACHABLE);
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
      setAskError(UNREACHABLE);
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
        setAskError(await aiError(res));
        return;
      }
      setAskResult((await res.json()) as AskResponse);
    } catch {
      setAskError(UNREACHABLE);
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
      setGenerateMessage(UNREACHABLE);
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
        setGenerateMessage(await aiError(res));
        return;
      }
      const body = (await res.json()) as SummaryResponse;
      setSummary(body);
      setSummaryError(null);
      setGenerateMessage(body.ai_generated ? 'Generated.' : 'Generated (AI was unavailable — plain aggregates only).');
    } catch {
      setGenerateMessage(UNREACHABLE);
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
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <UIText variant="title3" accessibilityRole="header" style={styles.sectionLabel}>
            Ask your data
          </UIText>
          <Card>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="Ask about waits, no-shows, counters…"
              placeholderTextColor={theme.inkMuted}
              onSubmitEditing={handleAsk}
              returnKeyType="send"
              submitBehavior="blurAndSubmit"
              multiline
              accessibilityLabel="Your question"
              style={[styles.askInput, Type.body, { color: theme.ink, borderColor: theme.hairlineStrong, backgroundColor: theme.canvasSoft }]}
            />
            <View style={styles.examples}>
              {EXAMPLES.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => setQuestion(q)}
                  accessibilityRole="button"
                  accessibilityHint="Fills in the question"
                  style={({ pressed }) => [styles.example, { backgroundColor: pressed ? theme.primarySoft : theme.surface, borderColor: theme.hairline }]}>
                  <UIText variant="secondary" color="primaryText">
                    {q}
                  </UIText>
                </Pressable>
              ))}
            </View>
            <Button label="Ask" onPress={handleAsk} loading={asking} disabled={!question.trim()} block />
            {askError ? (
              <UIText variant="secondary" color="danger" accessibilityLiveRegion="polite">
                {askError}
              </UIText>
            ) : null}
          </Card>

          {askResult ? (
            <Card>
              <View style={styles.cardHead}>
                <UIText variant="bodyStrong">Answer</UIText>
                {askResult.ai_generated ? <AiBadge /> : null}
              </View>
              <UIText variant="body">{askResult.answer}</UIText>
              <RowsList rows={askResult.rows} functionName={askResult.function} />
            </Card>
          ) : null}

          <UIText variant="title3" accessibilityRole="header" style={styles.sectionLabel}>
            Daily summary
          </UIText>
          <Card>
            {summaryLoading ? (
              <View accessibilityLabel="Loading summary" style={styles.skeleton}>
                <Skeleton height={18} />
                <Skeleton height={18} />
                <Skeleton height={18} width="60%" />
              </View>
            ) : summary ? (
              <>
                <View style={styles.cardHead}>
                  <UIText variant="secondaryStrong" color="inkSecondary">
                    {summary.day}
                  </UIText>
                  {summary.ai_generated ? <AiBadge /> : null}
                </View>
                <UIText variant="body">{summary.report}</UIText>
              </>
            ) : (
              <UIText variant="secondary">{summaryError ?? 'No summary has been generated yet.'}</UIText>
            )}

            {generateMessage ? (
              <UIText variant="secondary" color={generateMessage.startsWith('Generated') ? 'success' : 'danger'} accessibilityLiveRegion="polite">
                {generateMessage}
              </UIText>
            ) : null}

            <Button label="Generate now" onPress={handleGenerate} loading={generating} variant="secondary" block />
          </Card>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  safeArea: { flex: 1, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  scroll: { paddingBottom: Spacing.xxl, gap: Spacing.sm },
  sectionLabel: { marginTop: Spacing.sm },
  askInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  example: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.pill,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.xs, flexWrap: 'wrap' },
  badge: { borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xxs },
  rows: { borderTopWidth: 1, paddingTop: Spacing.sm, gap: Spacing.xxs },
  rowLine: { paddingVertical: Spacing.xs },
  skeleton: { gap: Spacing.xs },
});
