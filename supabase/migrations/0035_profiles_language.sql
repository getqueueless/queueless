alter table public.profiles add column language text not null default 'en'
  constraint profiles_language_valid check (language in ('en', 'hi', 'pa'));

create function public.set_my_language(p_language text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  if p_language not in ('en', 'hi', 'pa') then
    perform private.fail(400, 'invalid_language', 'Unsupported language');
  end if;

  update public.profiles set language = p_language where id = v_uid
    returning * into v_profile;

  return v_profile;
end;
$$;

revoke execute on function public.set_my_language(text) from public, anon;
grant execute on function public.set_my_language(text) to authenticated;
