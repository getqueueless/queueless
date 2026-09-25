import { supabase } from '@/lib/supabase';

// apps/api's patient help endpoints: GET /help/faq and POST /help/ask. The parsers accept a few
// likely shapes so the screens work while the API contract settles; normalize here, not in UI.

export type FaqItem = { id: string; question: string; answer: string };
export type FaqGroup = { title: string; items: FaqItem[] };
export type AskAnswer = { answer: string; basedOn: { id: string; question: string }[] };
export type AskResult =
  | { ok: true; data: AskAnswer }
  | { ok: false; kind: 'rate_limited'; retryAfter: number | null }
  | { ok: false; kind: 'error'; message: string };

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.lpu.lol';

async function headers(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

type Raw = Record<string, unknown>;
const str = (...v: unknown[]) => (v.find((x) => typeof x === 'string' && x.trim()) as string | undefined) ?? '';

function item(raw: Raw, i: number): FaqItem {
  return {
    id: str(raw.id, raw.slug, raw.key) || String(i),
    question: str(raw.question, raw.q, raw.title),
    answer: str(raw.answer, raw.a, raw.body, raw.text),
  };
}

/** Groups in server order; flat lists are grouped by their category/group/section field. */
export async function fetchFaq(): Promise<FaqGroup[]> {
  const res = await fetch(`${BASE}/help/faq`, { headers: await headers(), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`faq ${res.status}`);
  const body = (await res.json()) as unknown;
  const root = (Array.isArray(body) ? { items: body } : (body as Raw)) ?? {};
  const groups = (root.groups ?? root.sections ?? root.categories) as Raw[] | undefined;
  if (Array.isArray(groups)) {
    return groups
      .map((g) => ({
        title: str(g.title, g.name, g.category) || 'General',
        items: ((g.items ?? g.faqs ?? g.questions ?? []) as Raw[]).map(item).filter((x) => x.question),
      }))
      .filter((g) => g.items.length > 0);
  }
  const flat = ((root.items ?? root.faqs ?? root.faq ?? []) as Raw[]).map((raw, i) => ({
    group: str(raw.category, raw.group, raw.section) || 'General',
    ...item(raw, i),
  }));
  const byGroup = new Map<string, FaqItem[]>();
  for (const { group, ...faq } of flat) if (faq.question) (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(faq);
  return [...byGroup].map(([title, items]) => ({ title, items }));
}

export async function askQueueless(question: string, lang: string): Promise<AskResult> {
  try {
    const res = await fetch(`${BASE}/help/ask`, {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ question, lang }),
      signal: AbortSignal.timeout(20000),
    });
    const body = ((await res.json().catch(() => null)) ?? {}) as Raw;
    const detail = body.detail as Raw | string | undefined;
    const code = str(body.error, body.code, typeof detail === 'object' ? detail?.error : detail);
    if (res.status === 429 || code === 'rate_limited') {
      const retry = Number(res.headers.get('retry-after') ?? body.retry_after ?? (typeof detail === 'object' ? detail?.retry_after : NaN));
      return { ok: false, kind: 'rate_limited', retryAfter: Number.isFinite(retry) ? retry : null };
    }
    if (!res.ok) return { ok: false, kind: 'error', message: str(typeof detail === 'string' ? detail : '', body.message) || `Something went wrong (${res.status}).` };
    const sources = (body.based_on ?? body.sources ?? body.basedOn ?? body.citations ?? []) as Raw[];
    return {
      ok: true,
      data: {
        answer: str(body.answer, body.text, body.reply),
        basedOn: (Array.isArray(sources) ? sources : []).map((s, i) => ({ id: str(s.id, s.slug) || String(i), question: str(s.question, s.q, s.title) })).filter((s) => s.question),
      },
    };
  } catch {
    return { ok: false, kind: 'error', message: "Couldn't reach Queueless. Check your connection." };
  }
}
