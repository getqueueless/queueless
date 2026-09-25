-- One AI-generated ops summary per org/day, written by apps/api's daily job, read by admins.
-- Schema and access pattern rewritten to match apps/api's ALREADY LANDED, ALREADY TESTED caller
-- exactly (app/summary.py's _write_ops_summary + app/routes/ai.py's admin_summary_get, and the
-- fixture they were built and tested against, apps/api/scripts/dev_db.py's SCHEMA_SQL) --
-- discovered mid-task via `git pull --rebase`. No `lang` column: translation happens live at
-- read time (routes/ai.py calls DeepSeek to translate `report` on GET when `?lang=hi|pa`), the
-- report itself is stored once per (org, day) in whatever language it was generated in.
create table public.ops_summaries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  report text not null,
  ai_generated boolean not null default true,
  aggregates jsonb not null,
  created_at timestamptz not null default now(),
  unique (org_id, day)
);

create index ops_summaries_org_day_idx on public.ops_summaries (org_id, day);

alter table public.ops_summaries enable row level security;
revoke all on public.ops_summaries from public, anon, authenticated;

grant select on public.ops_summaries to authenticated;
create policy ops_summaries_admin_read on public.ops_summaries
  for select to authenticated
  using (org_id = private.my_org() and private.my_role() = 'admin');

-- queueless_api upserts: `INSERT ... ON CONFLICT (org_id, day) DO UPDATE` is the real, already-
-- landed write path (one summary per org per day; a re-run for the same day replaces it, it
-- does not accumulate stale rows) -- needs insert AND update, not insert-only.
grant select, insert, update on public.ops_summaries to queueless_api;
create policy ops_summaries_api_read on public.ops_summaries
  for select to queueless_api using (true);
create policy ops_summaries_api_insert on public.ops_summaries
  for insert to queueless_api with check (true);
create policy ops_summaries_api_update on public.ops_summaries
  for update to queueless_api using (true) with check (true);
