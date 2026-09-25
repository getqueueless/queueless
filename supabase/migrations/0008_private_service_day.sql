create function private.service_day(p_org uuid, p_now timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_now at time zone o.timezone)::date
  from public.organizations o
  where o.id = p_org;
$$;
