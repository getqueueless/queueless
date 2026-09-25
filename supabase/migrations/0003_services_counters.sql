create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  code text not null,
  name text not null,
  is_open boolean not null default true,
  default_service_secs int not null default 300,
  no_show_minutes int not null default 5,
  max_tokens_per_day int not null default 500,
  created_at timestamptz not null default now(),
  constraint services_code_len check (char_length(code) between 1 and 3),
  unique (org_id, code)
);

create index services_org_id_idx on public.services (org_id);

create table public.counters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  state public.counter_state not null default 'closed',
  staff_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index counters_org_id_idx on public.counters (org_id);
create index counters_staff_id_idx on public.counters (staff_id);

create table public.counter_services (
  counter_id uuid not null references public.counters (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  primary key (counter_id, service_id)
);

create index counter_services_service_id_idx on public.counter_services (service_id);

create table private.service_days (
  service_id uuid not null references public.services (id) on delete cascade,
  day date not null,
  last_number int not null default 0,
  primary key (service_id, day)
);
