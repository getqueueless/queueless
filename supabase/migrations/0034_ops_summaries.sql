-- One AI-generated ops summary per org/day/language, written by apps/api, read by admins.
create table public.ops_summaries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  lang text not null default 'en',
  summary_text text not null,
  model text not null,
  created_at timestamptz not null default now(),
  constraint ops_summaries_lang_valid check (lang in ('en', 'hi', 'pa')),
  unique (org_id, day, lang)
);

create index ops_summaries_org_day_idx on public.ops_summaries (org_id, day);

alter table public.ops_summaries enable row level security;
revoke all on public.ops_summaries from public, anon, authenticated;

grant select on public.ops_summaries to authenticated;
create policy ops_summaries_admin_read on public.ops_summaries
  for select to authenticated
  using (org_id = private.my_org() and private.my_role() = 'admin');

-- queueless_api can insert and select, not update or delete: it writes each summary once per
-- (org, day, lang); the unique constraint is the backstop. A future regenerate-in-place feature
-- would need an UPDATE grant too -- not added, wasn't asked for, and this keeps the write path a
-- pure append.
grant select, insert on public.ops_summaries to queueless_api;
create policy ops_summaries_api_read on public.ops_summaries
  for select to queueless_api using (true);
create policy ops_summaries_api_insert on public.ops_summaries
  for insert to queueless_api with check (true);
