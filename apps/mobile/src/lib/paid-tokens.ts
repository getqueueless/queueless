// Local-only record of "Book & pay" successes, keyed by token id -> ISO paid-at timestamp.
// There's no `payments`/receipts table anywhere in supabase/migrations (checked through 0042),
// so this is the only place "you paid for this" is remembered — per-device, not synced, gone on
// reinstall. Good enough for History's receipt line; see docs/DECISIONS.md for the real gap.
const KEY = 'queueless-paid-tokens';

type PaidTokens = Record<string, string>;

function readAll(): PaidTokens {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PaidTokens) : {};
  } catch {
    return {};
  }
}

export function markTokenPaid(tokenId: string): void {
  try {
    const all = readAll();
    all[tokenId] = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Non-fatal — the receipt line just won't show up later this run.
  }
}

export function getPaidAt(tokenId: string): string | null {
  return readAll()[tokenId] ?? null;
}
