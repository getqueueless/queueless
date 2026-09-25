-- Real RLS (not just table grants) for the 4 tables the hand-run prod hotfix (0063) only
-- narrowed write access on. Model, per table: a patient sees their own rows; staff/admin see
-- their own org's rows; nobody writes directly (every write already goes through a SECURITY
-- DEFINER RPC -- verified empirically: no `.update`/`.insert`/`.delete` against any of these 4
-- tables exists anywhere in apps/web or apps/mobile, except notifications' own read_at toggle,
-- which the hotfix already scoped to that one column). SECURITY DEFINER functions (mint_token,
-- call_next, tokens_after_write, complete_my_profile, book_appointment, check_in,
-- private.housekeeping, ...) are all owned by `postgres`, which RLS never restricts as table
-- owner -- none of them need any change here.
--
-- appointments and audit_log have no org_id column of their own: appointments' org lives on
-- public.services (via service_id), audit_log's org_id is a direct column already.

-- tokens ----------------------------------------------------------------------------------
alter table public.tokens enable row level security;
grant select on public.tokens to authenticated;

create policy tokens_read_own on public.tokens
  for select to authenticated
  using (patient_id = auth.uid());

create policy tokens_read_org_staff on public.tokens
  for select to authenticated
  using (private.is_staff_of(org_id));

-- TEMPORARY: two anon-facing pages still do a raw `.from("tokens").select(...).eq("id", ...)`
-- for a single token -- /t/[id] (apps/web/src/app/t/[id]/data.ts) and /pay/[tokenId]
-- (apps/web/src/app/pay/[tokenId]/data.ts, payments' own migration range). 0048 gives /t/[id] a
-- purpose-built get_token_status RPC to replace this; /pay/[tokenId] hasn't been asked to move
-- yet. This policy is exactly as wide as anon's pre-existing, unrestricted table grant already
-- was -- not a new hole -- and should be dropped the same day both callers are off direct reads.
create policy tokens_read_anon_temporary on public.tokens
  for select to anon
  using (true);

-- apps/api (queueless_api) already has its own pre-existing `select on tokens` (0018); RLS off
-- meant that worked with no policy. Same fix as profiles_api_read (0045)/push_tokens_api_read
-- (0018): match the grant with a policy, or it silently starts returning zero rows.
create policy tokens_api_read on public.tokens
  for select to queueless_api
  using (true);

-- appointments ------------------------------------------------------------------------------
alter table public.appointments enable row level security;
grant select on public.appointments to authenticated;

create policy appointments_read_own on public.appointments
  for select to authenticated
  using (patient_id = auth.uid());

create policy appointments_read_org_staff on public.appointments
  for select to authenticated
  using (exists (
    select 1 from public.services s where s.id = appointments.service_id and private.is_staff_of(s.org_id)
  ));

-- notifications -----------------------------------------------------------------------------
alter table public.notifications enable row level security;
grant select on public.notifications to authenticated;
-- `update (read_at) to authenticated` was already granted by 0063 (numbered later, in the payments range, but part of the same final schema) -- this migration adds the
-- missing row-scoping so that column grant only ever touches the caller's own notification.

create policy notifications_read_own on public.notifications
  for select to authenticated
  using (patient_id = auth.uid());

create policy notifications_read_org_staff on public.notifications
  for select to authenticated
  using (
    exists (select 1 from public.tokens t where t.id = notifications.token_id and private.is_staff_of(t.org_id))
    or exists (
      select 1 from public.appointments a join public.services s on s.id = a.service_id
      where a.id = notifications.appointment_id and private.is_staff_of(s.org_id)
    )
  );

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (patient_id = auth.uid())
  with check (patient_id = auth.uid());

-- apps/api (queueless_api) has pre-existing `select` + `update (pushed_at)` grants (0031) for
-- its push-notification worker -- same reasoning as tokens_api_read above.
create policy notifications_api_read on public.notifications
  for select to queueless_api
  using (true);
create policy notifications_api_update on public.notifications
  for update to queueless_api
  using (true)
  with check (true);

-- audit_log -----------------------------------------------------------------------------------
alter table public.audit_log enable row level security;
grant select on public.audit_log to authenticated;

create policy audit_log_read_org_staff on public.audit_log
  for select to authenticated
  using (org_id is not null and private.is_staff_of(org_id));
