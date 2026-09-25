create function public.cancel_token(p_token uuid)
returns public.tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_token public.tokens;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  update public.tokens
    set status = 'cancelled'
    where id = p_token and patient_id = v_patient and status = 'waiting'
    returning * into v_token;

  if v_token.id is null then
    perform private.fail(409, 'illegal_transition', 'That ticket cannot be cancelled right now');
  end if;

  return v_token;
end;
$$;

revoke execute on function public.cancel_token(uuid) from public, anon;
grant execute on function public.cancel_token(uuid) to authenticated;
