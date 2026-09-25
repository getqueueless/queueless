create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  expo_token text not null unique,
  platform text not null,
  created_at timestamptz not null default now(),
  constraint push_tokens_platform_valid check (platform in ('ios', 'android', 'web'))
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

revoke all on public.push_tokens from public, anon;
grant select, insert, update, delete on public.push_tokens to authenticated;

create policy push_tokens_owner on public.push_tokens
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
