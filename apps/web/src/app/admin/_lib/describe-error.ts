import { errorInfo } from "@queueless/db"

// Reuses the shared error-code map (@queueless/db) other agents' RPCs already
// speak. On top of that, this table isn't RPC traffic -- it's plain
// PostgREST table access, which fails with raw Postgres codes when the DB
// agent hasn't shipped RLS + grants yet (currently: no `create policy` and
// no `grant` statements at all in supabase/migrations, so every table read
// is expected to 401/42501 until that lands).
export function describeSupabaseError(error: { code?: string; message?: string } | null): string {
  if (!error) return "Something went wrong."

  if (error.code === "42501" || error.code === "PGRST301") {
    return "Live data isn't available yet. Database permissions (RLS and grants) haven't been deployed."
  }
  if (error.code === "42P01") {
    return "This table hasn't been migrated yet."
  }
  if (error.code) {
    const known = errorInfo(error.code)
    if (known.message !== "Something went wrong") return known.message
  }
  return error.message ?? "Something went wrong."
}
