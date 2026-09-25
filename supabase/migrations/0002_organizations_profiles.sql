create schema if not exists private;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null default 'hospital',
  timezone text not null default 'Asia/Kolkata',
  priority_head_start_minutes int not null default 15,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  org_id uuid references public.organizations (id) on delete set null,
  role public.user_role not null default 'patient',
  full_name text,
  phone text,
  priority_status public.lane,
  priority_verified_by uuid references public.profiles (id) on delete set null,
  priority_verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint profiles_priority_status_valid
    check (priority_status is null or priority_status in ('senior', 'pregnant'))
);

create index profiles_org_id_idx on public.profiles (org_id);

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
begin
  v_full_name := nullif(trim(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80)), '');
  insert into public.profiles (id, org_id, role, full_name, priority_status)
  values (new.id, null, 'patient', v_full_name, null);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
