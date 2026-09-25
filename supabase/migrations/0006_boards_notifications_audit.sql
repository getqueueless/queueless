create table public.board_services (
  service_id uuid not null references public.services (id) on delete cascade,
  day date not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  waiting_count int not null default 0,
  served_count int not null default 0,
  no_show_count int not null default 0,
  last_called_code text,
  avg_service_secs int,
  updated_at timestamptz not null default now(),
  primary key (service_id, day)
);

create index board_services_org_id_idx on public.board_services (org_id);

create table public.board_counters (
  counter_id uuid primary key references public.counters (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  counter_name text not null,
  state public.counter_state not null,
  token_code text,
  token_status public.token_status,
  updated_at timestamptz not null default now()
);

create index board_counters_org_id_idx on public.board_counters (org_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles (id),
  token_id uuid references public.tokens (id),
  appointment_id uuid references public.appointments (id),
  kind text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_kind_valid
    check (kind in ('called', 'almost_turn', 'no_show', 'expired', 'appointment_reminder')),
  constraint notifications_has_owner check (token_id is not null or appointment_id is not null),
  unique (token_id, kind),
  unique (appointment_id, kind)
);

create index notifications_patient_id_idx on public.notifications (patient_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor uuid default auth.uid(),
  entity text not null,
  entity_id uuid,
  action text not null,
  old jsonb,
  new jsonb,
  at timestamptz not null default now()
);

create index audit_log_org_id_idx on public.audit_log (org_id, at);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

create function private.forbid_audit_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function private.forbid_audit_log_mutation();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function private.forbid_audit_log_mutation();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.forbid_audit_log_mutation();
