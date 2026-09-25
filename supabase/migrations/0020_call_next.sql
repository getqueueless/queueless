create function public.call_next(p_counter uuid)
returns setof public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  c public.counters;
  v_busy public.tokens;
  v_token public.tokens;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into c from public.counters where id = p_counter for update;

  if not exists (
    select 1 from public.profiles where id = v_staff and org_id = c.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  if c.state <> 'open' then
    perform private.fail(409, 'counter_closed', 'That desk is closed');
  end if;

  select * into v_busy from public.tokens
    where counter_id = p_counter and status in ('called', 'serving')
    limit 1;
  if v_busy.id is not null then
    perform private.fail(409, 'counter_busy', 'That desk is already serving someone',
      null, json_build_object('token_id', v_busy.id, 'code', v_busy.code)::jsonb);
  end if;

  update public.tokens
    set status = 'called', counter_id = p_counter, called_at = now()
    where id = (
      select t.id from public.tokens t
      where t.org_id = c.org_id
        and t.service_id in (select cs.service_id from public.counter_services cs where cs.counter_id = p_counter)
        and t.service_day = private.service_day(c.org_id, now())
        and t.status = 'waiting'
      order by t.lane_rank, t.priority_at, t.number
      limit 1
      for no key update of t skip locked
    )
    returning * into v_token;

  if v_token.id is not null then
    return next v_token;
  end if;
  return;
end;
$$;

revoke execute on function public.call_next(uuid) from public, anon;
grant execute on function public.call_next(uuid) to authenticated;
