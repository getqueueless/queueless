create function private.audit_generic_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (org_id, entity, entity_id, action, old, new)
  values (
    (v_row ->> 'org_id')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    tg_op,
    to_jsonb(old),
    to_jsonb(new)
  );
  return coalesce(new, old);
end;
$$;

create trigger services_audit
  after insert or update on public.services
  for each row execute function private.audit_generic_change();

create trigger counters_audit
  after insert or update on public.counters
  for each row execute function private.audit_generic_change();

create trigger profiles_audit
  after update on public.profiles
  for each row
  when (old.role is distinct from new.role or old.priority_status is distinct from new.priority_status)
  execute function private.audit_generic_change();

create trigger appointments_audit
  after update on public.appointments
  for each row execute function private.audit_generic_change();

create function private.audit_counter_services_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (org_id, entity, entity_id, action, old, new)
  values (null, 'counter_services', coalesce(new.counter_id, old.counter_id), tg_op, to_jsonb(old), to_jsonb(new));
  return coalesce(new, old);
end;
$$;

create trigger counter_services_audit
  after insert or delete on public.counter_services
  for each row execute function private.audit_counter_services_change();

create function private.counters_refresh_board()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.board_counters (counter_id, org_id, counter_name, state, updated_at)
  values (new.id, new.org_id, new.name, new.state, now())
  on conflict (counter_id) do update set
    org_id = excluded.org_id,
    counter_name = excluded.counter_name,
    state = excluded.state,
    updated_at = now();
  return new;
end;
$$;

create trigger counters_refresh_board
  after insert or update on public.counters
  for each row execute function private.counters_refresh_board();
