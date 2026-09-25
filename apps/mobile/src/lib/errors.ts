import { ERRORS, errorInfo, type ErrorCode } from '@queueless/db';

const KNOWN_CODES = new Set<string>(Object.keys(ERRORS));

/**
 * RPC errors from Supabase land as PostgrestError, but self-hosted Postgres exceptions can
 * surface the semantic code (`already_active`, `service_closed`, ...) as either `.code` or
 * `.message` depending on how the function raises it — check both.
 */
export function mapSupabaseError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return errorInfo('network_error').message;
  const code = error.code && KNOWN_CODES.has(error.code) ? error.code : undefined;
  const fromMessage = !code && error.message && KNOWN_CODES.has(error.message) ? error.message : undefined;
  return errorInfo((code ?? fromMessage ?? 'network_error') as ErrorCode).message;
}

const AUTH_MESSAGES: Record<string, string> = {
  // GoTrue reuses this one code for a wrong code, an expired code, and an already-used code —
  // don't try to distinguish them, one message covers all three (Supabase docs; unverified
  // against a live SMTP relay from here — see docs/DECISIONS.md).
  otp_expired: "That code's wrong or expired — request a new one.",
  over_email_send_rate_limit: 'Too many codes sent — wait a bit and try again.',
  over_request_rate_limit: 'Too many attempts — wait a moment and try again.',
};

/** GoTrue (Supabase Auth) errors carry their own human-readable message — the RPC error map doesn't apply here. */
export function mapAuthError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return errorInfo('network_error').message;
  if (error.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code];
  return error.message || errorInfo('network_error').message;
}
