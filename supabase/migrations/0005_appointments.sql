create table public.appointment_slots (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services (id) on delete cascade,
  starts_at timestamptz not null,
  capacity int not null default 1,
  booked int not null default 0,
  created_at timestamptz not null default now(),
  constraint appointment_slots_booked_range check (booked between 0 and capacity),
  unique (service_id, starts_at)
);

create index appointment_slots_service_id_idx on public.appointment_slots (service_id);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.appointment_slots (id),
  service_id uuid not null references public.services (id),
  patient_id uuid not null references public.profiles (id),
  status public.appointment_status not null default 'booked',
  token_id uuid unique references public.tokens (id),
  created_at timestamptz not null default now()
);

create unique index appointments_one_booked on public.appointments (patient_id, service_id)
  where status = 'booked';

create index appointments_slot_id_idx on public.appointments (slot_id);
create index appointments_service_id_idx on public.appointments (service_id);
create index appointments_patient_id_idx on public.appointments (patient_id);
create index appointments_starts_at_sweep on public.appointments (status, slot_id);

alter table public.tokens
  add constraint tokens_appointment_id_fkey foreign key (appointment_id) references public.appointments (id);
