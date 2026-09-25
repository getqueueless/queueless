create function public.start_serving(p_token uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_token public.tokens;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_token from public.tokens where id = p_token;
  if v_token.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if not exists (
    select 1 from public.profiles where id = v_staff and org_id = v_token.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  update public.tokens set status = 'serving', serving_at = now()
    where id = p_token and status = 'called'
    returning * into v_token;
  if v_token.id is null then
    perform private.fail(409, 'illegal_transition', 'That ticket cannot start serving right now');
  end if;

  return v_token;
end;
$$;

revoke execute on function public.start_serving(uuid) from public, anon;
grant execute on function public.start_serving(uuid) to authenticated;

create function public.complete_token(p_token uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_token public.tokens;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_token from public.tokens where id = p_token;
  if v_token.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if not exists (
    select 1 from public.profiles where id = v_staff and org_id = v_token.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  update public.tokens set status = 'done', finished_at = now()
    where id = p_token and status = 'serving'
    returning * into v_token;
  if v_token.id is null then
    perform private.fail(409, 'illegal_transition', 'That ticket cannot be completed right now');
  end if;

  return v_token;
end;
$$;

revoke execute on function public.complete_token(uuid) from public, anon;
grant execute on function public.complete_token(uuid) to authenticated;

create function public.skip_token(p_token uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_token public.tokens;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_token from public.tokens where id = p_token;
  if v_token.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if not exists (
    select 1 from public.profiles where id = v_staff and org_id = v_token.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  update public.tokens set status = 'skipped'
    where id = p_token and status = 'called'
    returning * into v_token;
  if v_token.id is null then
    perform private.fail(409, 'illegal_transition', 'That ticket cannot be skipped right now');
  end if;

  return v_token;
end;
$$;

revoke execute on function public.skip_token(uuid) from public, anon;
grant execute on function public.skip_token(uuid) to authenticated;

create function public.recall_token(p_token uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := auth.uid();
  v_token public.tokens;
  c public.counters;
begin
  if v_staff is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  select * into v_token from public.tokens where id = p_token;
  if v_token.id is null then
    perform private.fail(404, 'not_found', 'We could not find that');
  end if;

  if not exists (
    select 1 from public.profiles where id = v_staff and org_id = v_token.org_id and role in ('staff', 'admin')
  ) then
    perform private.fail(403, 'forbidden', 'You do not have permission to do that');
  end if;

  select * into c from public.counters where id = v_token.counter_id for update;

  if v_token.status = 'called' then
    if v_token.recall_count >= 2 then
      perform private.fail(409, 'illegal_transition', 'This ticket has already been recalled twice');
    end if;
    update public.tokens set recall_count = recall_count + 1, called_at = now()
      where id = p_token returning * into v_token;
    return v_token;
  end if;

  if v_token.status in ('no_show', 'skipped')
     and v_token.service_day = private.service_day(v_token.org_id, now())
     and v_token.recall_count < 2 then
    if exists (
      select 1 from public.tokens where counter_id = v_token.counter_id and status in ('called', 'serving')
    ) then
      perform private.fail(409, 'counter_busy', 'That desk is currently serving someone else');
    end if;
    update public.tokens set status = 'called', recall_count = recall_count + 1, called_at = now()
      where id = p_token returning * into v_token;
    return v_token;
  end if;

  perform private.fail(409, 'illegal_transition', 'That ticket cannot be recalled right now');
end;
$$;

revoke execute on function public.recall_token(uuid) from public, anon;
grant execute on function public.recall_token(uuid) to authenticated;
