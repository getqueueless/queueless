create function private.my_role()
returns public.user_role
language sql
security definer
stable
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

create function private.my_org()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create function private.is_staff_of(p_org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and org_id = p_org and role in ('staff', 'admin')
  );
$$;

create function private.is_admin_of(p_org uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and org_id = p_org and role = 'admin'
  );
$$;

alter default privileges in schema private revoke execute on functions from public;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function private.my_role() to authenticated;
grant execute on function private.my_org() to authenticated;
grant execute on function private.is_staff_of(uuid) to authenticated;
grant execute on function private.is_admin_of(uuid) to authenticated;
