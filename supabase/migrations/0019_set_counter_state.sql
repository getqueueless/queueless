create function public.set_counter_state(p_counter uuid, p_state public.counter_state)
returns public.counters
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_counter public.counters;
  v_busy public.tokens;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_counter from public.counters where id = p_counter;
  if v_counter.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_staff and org_id = v_counter.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  if p_state in ('paused', 'closed') then
    select * into v_busy from public.tokens
      where counter_id = p_counter and status in ('called', 'serving')
      limit 1;
    if v_busy.id is not null then
      perform private.fail(409, 'counter_busy', 'That desk is currently serving a ticket',
        null, json_build_object('token_id', v_busy.id, 'code', v_busy.code)::jsonb);
    end if;
  end if;

  update public.counters set state = p_state where id = p_counter
    returning * into v_counter;

  return v_counter;
end;
$$;

revoke execute on function public.set_counter_state(uuid, public.counter_state) from public, anon;
grant execute on function public.set_counter_state(uuid, public.counter_state) to authenticated;
