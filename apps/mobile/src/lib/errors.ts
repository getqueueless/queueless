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
