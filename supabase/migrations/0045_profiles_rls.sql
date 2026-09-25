-- QA #2 asked to check whether an admin can read staff full_name in their own org through RLS.
-- The literal answer is: nothing was stopping it -- public.profiles has NEVER had row level
-- security enabled (checked every migration since 0002; also confirmed empirically:
-- `relrowsecurity` is false and `has_table_privilege('anon', 'public.profiles', 'SELECT')` AND
-- `'UPDATE'` are both true). "Unnamed staff" is therefore a data issue (some profile rows
-- genuinely have a null full_name), not an access issue -- there's no RLS fix for that, and it's
-- out of this migration's scope (supabase/ + docs/ only, no app code).
--
-- What the same check turned up instead is worse: with RLS off and the table wide open to
-- `anon`/`authenticated` by default grant, ANY signed-in patient can currently read every other
-- user's full_name/phone/org_id, and -- far more serious -- can UPDATE their own `role` column
-- directly via PostgREST (`patch /rest/v1/profiles?id=eq.<self>` with `{"role":"admin"}`) and
-- grant themselves staff/admin access to any org. That's a privilege-escalation hole, not a
-- missing-name cosmetic bug, so it's fixed here even though it's broader than the one page named
-- in the report.
--
-- Policy model reuses the org-scoping helpers already built for exactly this in 0029
-- (private.is_staff_of), which nothing had actually called yet:
--   - a user can always read and update their own row
--   - staff/admin can read every profile in their own org (this is what unblocks
--     /admin/counters and /admin/staff's client-side staff list -- both query profiles without
--     an explicit org_id filter today; RLS is now the thing that scopes them correctly even so)
--   - queueless_api keeps its existing (narrower, column-level) read access, matching the
--     push_tokens_api_read precedent from 0018
--   - the column-level grant to `authenticated` deliberately excludes `role` and `org_id` --
--     self-service profile edits (full_name, phone, language) go through PostgREST directly, but
--     role/org changes only ever happen through the admin API routes, which already use the
--     service-role key and so bypass RLS and column grants entirely (see
--     apps/web/src/app/api/admin/staff/route.ts) -- nothing legitimate needs a client-side path
--     to change its own role.
alter table public.profiles enable row level security;

revoke all on public.profiles from public, anon, authenticated;
grant select, update (full_name, phone, language) on public.profiles to authenticated;

create policy profiles_read_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_read_org_staff on public.profiles
  for select to authenticated
  using (org_id is not null and private.is_staff_of(org_id));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_api_read on public.profiles
  for select to queueless_api
  using (true);
