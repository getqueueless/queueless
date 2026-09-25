create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid not null references public.services (id),
  service_day date not null,
  number int not null,
  code text not null,
  lane public.lane not null,
  lane_rank smallint not null,
  priority_at timestamptz not null,
  status public.token_status not null default 'waiting',
  patient_id uuid references public.profiles (id),
  walk_in_label text,
  issued_by uuid references public.profiles (id) on delete set null,
  appointment_id uuid unique,
  counter_id uuid references public.counters (id),
  recall_count smallint not null default 0,
  created_at timestamptz not null default now(),
  called_at timestamptz,
  serving_at timestamptz,
  finished_at timestamptz,
  constraint tokens_lane_rank_valid check (lane_rank in (0, 1)),
  constraint tokens_has_holder check (patient_id is not null or walk_in_label is not null),
  constraint tokens_walk_in_label_len
    check (walk_in_label is null or char_length(walk_in_label) between 1 and 40),
  constraint tokens_service_day_number_unique unique (service_id, service_day, number)
);

create unique index tokens_one_active on public.tokens (patient_id, service_id)
  where status in ('waiting', 'called', 'serving');

create unique index tokens_one_per_desk on public.tokens (counter_id)
  where status in ('called', 'serving');

create index tokens_queue on public.tokens (service_id, service_day, lane_rank, priority_at, number)
  where status = 'waiting';

create index tokens_patient_rate_limit on public.tokens (patient_id, created_at);
create index tokens_no_show_sweep on public.tokens (status, called_at);
create index tokens_stale_day_sweep on public.tokens (status, service_day);
create index tokens_org_id_idx on public.tokens (org_id);
create index tokens_issued_by_idx on public.tokens (issued_by);
