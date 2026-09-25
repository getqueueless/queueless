-- apps/api needs to log its own actions (push delivery, ops-summary generation) into the same
-- audit trail as the RPCs, without a raw INSERT grant on audit_log -- that table stays fully
-- locked down from queueless_api (confirmed by 0031's own test: queueless_api can read no table
-- outside its granted list, and audit_log was never on it). This is a narrow, append-only door:
-- actor is left null, same as housekeeping's cron-originated rows, because queueless_api isn't a
-- signed-in user.
create function private.write_audit(
  p_org uuid, p_entity text, p_entity_id uuid, p_action text,
  p_old jsonb default null, p_new jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (org_id, entity, entity_id, action, old, new)
  values (p_org, p_entity, p_entity_id, p_action, p_old, p_new);
end;
$$;

revoke execute on function private.write_audit(uuid, text, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function private.write_audit(uuid, text, uuid, text, jsonb, jsonb) to queueless_api;

-- board_services read for queueless_api was already granted+policied in 0031
-- (board_services_api_read); nothing further needed for that half of this task.
