-- cash_receipts is append-only by trigger (0041): every UPDATE/DELETE/TRUNCATE is rejected
-- unconditionally, even for the table owner -- BEFORE triggers fire regardless of who's
-- connected, GRANT/REVOKE and table ownership don't change that. That's the right rule for
-- real receipts, but supabase/scripts/demo-reset.sh needs to wipe *today's demo* receipts on
-- every run (it's meant to give a fresh "right now" queue for a walkthrough, run repeatedly),
-- and it currently can't -- the only way to actually delete a cash_receipts row is this one
-- narrow, audited bypass, never a raw DISABLE TRIGGER from the shell script.
--
-- session_replication_role = 'replica' is the standard Postgres way to make ordinary
-- (non-ALWAYS) triggers not fire; `set local` scopes it to the current transaction, but
-- demo-reset.sh runs its whole script as one transaction (`psql -1`), so leaving it on
-- 'replica' after this delete would silently disable every other trigger (audit triggers,
-- notification triggers, ...) for the rest of that same transaction -- so this function sets
-- it back to 'origin' itself, right after the delete, rather than trusting the transaction
-- boundary to clean up after it.
create function private.demo_reset_cash_receipts(p_org_id uuid, p_day date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  set local session_replication_role = 'replica';

  delete from public.cash_receipts
  where org_id = p_org_id
    and (created_at at time zone (select timezone from public.organizations where id = p_org_id))::date = p_day;

  get diagnostics v_deleted = row_count;

  set local session_replication_role = 'origin';

  insert into public.audit_log (org_id, entity, entity_id, action, new)
  values (p_org_id, 'cash_receipts', null, 'demo_reset_cash_receipts',
    json_build_object('day', p_day, 'deleted_count', v_deleted)::jsonb);

  return v_deleted;
end;
$$;

-- Not for authenticated/anon at all -- this is an ops-script bypass of a production safety
-- rule, not a feature. postgres (demo-reset.sh's own connection) already ignores grants
-- entirely as the function owner, so this grant only matters for a service_role-authenticated
-- caller (e.g. an admin "reset the demo" button through PostgREST, if one gets built later).
revoke execute on function private.demo_reset_cash_receipts(uuid, date) from public, anon, authenticated;
grant execute on function private.demo_reset_cash_receipts(uuid, date) to service_role;
