-- Codifies, verbatim, the hand-run hotfix infra applied directly to prod (SQL preserved at
-- /tmp/claude-1000/-home-yash/c809a631-aa1b-428c-8dfd-3281cb33a9d3/scratchpad/hotfix-grants.sql)
-- after finding tokens, profiles, appointments, notifications, audit_log and counter_services
-- had RLS off with full anon/authenticated grants -- anyone with the public anon key could wipe
-- tokens or PATCH their own role to admin. This migration exists so a fresh `db:reset` lands in
-- the SAME state prod is already in, not so it re-applies anything: prod already has this. Do
-- not edit this file to "improve" it -- it's a historical record of what was actually run.
--
-- 0045 (profiles RLS) already independently covers profiles more strictly than this hotfix does;
-- running both is fine, RLS/grants only get more restrictive, never less. tokens/appointments/
-- notifications/audit_log get real RLS policies (not just table grants) in 0047.
begin;

-- No client ever needs these; TRUNCATE also bypasses RLS entirely.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
-- All writes to these go through SECURITY DEFINER RPCs or the service role.
revoke insert, update, delete on public.tokens, public.appointments, public.audit_log,
  public.profiles, public.payments_ledger, public.doctor_status_today from anon, authenticated;
-- Anonymous visitors never read private data (the /t/[id] page only needs tokens).
revoke all on public.profiles, public.appointments, public.notifications, public.audit_log,
  public.payments_ledger from anon;
-- notifications: the app only marks its own as read.
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- counter_services: readable by all, writable by the org's admin only.
revoke all on public.counter_services from anon, authenticated;
grant select on public.counter_services to anon, authenticated;
grant insert, delete on public.counter_services to authenticated;
alter table public.counter_services enable row level security;
drop policy if exists counter_services_read on public.counter_services;
create policy counter_services_read on public.counter_services for select to anon, authenticated using (true);
drop policy if exists counter_services_admin_insert on public.counter_services;
create policy counter_services_admin_insert on public.counter_services for insert to authenticated
  with check (private.my_role() = 'admin' and exists (select 1 from public.counters c where c.id = counter_id and c.org_id = private.my_org()));
drop policy if exists counter_services_admin_delete on public.counter_services;
create policy counter_services_admin_delete on public.counter_services for delete to authenticated
  using (private.my_role() = 'admin' and exists (select 1 from public.counters c where c.id = counter_id and c.org_id = private.my_org()));

commit;
