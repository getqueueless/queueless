-- Idempotent demo config + 14 days of synthetic history for org "city-hospital".
-- Run as postgres (bypasses RLS; calls owner-only private.mint_token/rebuild_boards directly).
-- Safe to run repeatedly: every step is guarded (on conflict / not exists).

insert into public.organizations (slug, name, kind, timezone)
values ('city-hospital', 'City Hospital (Demo)', 'hospital', 'Asia/Kolkata')
on conflict (slug) do nothing;

select id as org_id from public.organizations where slug = 'city-hospital' \gset

-- accounts: promote the ones created by seed.sh's admin-API calls
update public.profiles set role = 'admin', org_id = :'org_id'
  where id = (select id from auth.users where email = 'admin@lpu.lol') and role <> 'admin';

update public.profiles set role = 'staff', org_id = :'org_id'
  where id in (
    select id from auth.users where email in ('counter1@lpu.lol', 'counter2@lpu.lol', 'counter3@lpu.lol')
  ) and role <> 'staff';

-- services
insert into public.services (org_id, code, name, is_open, default_service_secs, no_show_minutes, max_tokens_per_day)
values
  (:'org_id', 'OPD', 'General OPD', true, 390, 5, 500),
  (:'org_id', 'PED', 'Pediatrics', true, 480, 5, 500),
  (:'org_id', 'ORT', 'Orthopedics', true, 750, 5, 500),
  (:'org_id', 'PHA', 'Pharmacy', true, 180, 5, 500)
on conflict (org_id, code) do nothing;

-- counters (no unique constraint on name -- guard with not exists)
insert into public.counters (org_id, name, state)
select :'org_id', v.name, 'closed'
from (values ('OPD-1'), ('OPD-2'), ('PED-1'), ('ORT-1'), ('PHA-1'), ('PHA-2')) as v(name)
where not exists (
  select 1 from public.counters c where c.org_id = :'org_id' and c.name = v.name
);

-- counter <-> service links (OPD-2 also takes Pediatrics overflow)
insert into public.counter_services (counter_id, service_id)
select c.id, s.id
from (values
  ('OPD-1', 'OPD'), ('OPD-2', 'OPD'), ('OPD-2', 'PED'),
  ('PED-1', 'PED'), ('ORT-1', 'ORT'), ('PHA-1', 'PHA'), ('PHA-2', 'PHA')
) as v(counter_name, service_code)
join public.counters c on c.org_id = :'org_id' and c.name = v.counter_name
join public.services s on s.org_id = :'org_id' and s.code = v.service_code
on conflict do nothing;

-- staff-to-counter assignments
update public.counters set staff_id = (select id from auth.users where email = 'counter1@lpu.lol')
  where org_id = :'org_id' and name in ('OPD-1', 'OPD-2');
update public.counters set staff_id = (select id from auth.users where email = 'counter2@lpu.lol')
  where org_id = :'org_id' and name in ('PED-1', 'ORT-1');
update public.counters set staff_id = (select id from auth.users where email = 'counter3@lpu.lol')
  where org_id = :'org_id' and name in ('PHA-1', 'PHA-2');

-- open 4 of 6 counters, leave a mixed fleet (one closed, one paused)
update public.counters set state = 'open' where org_id = :'org_id' and name in ('OPD-1', 'PED-1', 'ORT-1', 'PHA-1');
update public.counters set state = 'closed' where org_id = :'org_id' and name = 'OPD-2';
update public.counters set state = 'paused' where org_id = :'org_id' and name = 'PHA-2';

-- appointment slots: today + tomorrow, every 15 minutes 09:00-17:00 IST, capacity 2, per service
insert into public.appointment_slots (service_id, starts_at, capacity)
select
  s.id,
  ((private.service_day(:'org_id', now()) + day_offset)::timestamp
    + interval '9 hours' + (slot_n * 15) * interval '1 minute') at time zone 'Asia/Kolkata',
  2
from public.services s
cross join generate_series(0, 1) as day_offset
cross join generate_series(0, 32) as slot_n -- 09:00 to 17:00 inclusive, 15-min steps
where s.org_id = :'org_id'
on conflict (service_id, starts_at) do nothing;

-- 14 days of synthetic history, oldest first, guarded so a rerun never doubles it
select set_config('queueless.seed_org_id', :'org_id', false);

do $$
declare
  v_org uuid := current_setting('queueless.seed_org_id')::uuid;
  v_svc record;
  v_names text[] := array['Asha','Ravi','Priya','Kiran','Meera','Vikram','Sunita','Arjun','Divya','Rohit',
                           'Neha','Sanjay','Pooja','Amit','Rekha','Deepak','Anita','Manoj','Kavita','Suresh'];
  v_peak_hours int[] := array[9,9,10,10,10,11,11,11,12,12,14,15,16,17];
  days_ago int;
  v_day date;
  v_is_weekend boolean;
  v_count int;
  i int;
  v_lane public.lane;
  v_arrival timestamptz;
  v_priority_arg timestamptz;
  v_wait interval;
  v_called_at timestamptz;
  v_serving_at timestamptz;
  v_finished_at timestamptz;
  v_patient uuid;
  v_walk_in text;
  v_tok uuid;
  v_outcome_no_show boolean;
  r double precision;
begin
  if exists (
    select 1 from public.tokens
    where org_id = v_org and service_day < private.service_day(v_org, now())
    limit 1
  ) then
    raise notice 'history already seeded, skipping';
    return;
  end if;

  for days_ago in reverse 14..1 loop
    v_day := private.service_day(v_org, now()) - days_ago;
    v_is_weekend := extract(dow from v_day) in (0, 6);

    for v_svc in
      select * from (values
        ('OPD', 20, 35, 300, 480),
        ('PED', 18, 28, 360, 600),
        ('ORT', 15, 25, 600, 900),
        ('PHA', 30, 45, 120, 240)
      ) as t(code, cnt_lo, cnt_hi, dur_lo, dur_hi)
    loop
      declare
        v_service_id uuid;
        v_num int;
        v_code text;
        v_lane_rank smallint;
      begin
        select id into v_service_id from public.services where org_id = v_org and code = v_svc.code;

        v_count := v_svc.cnt_lo + floor(random() * (v_svc.cnt_hi - v_svc.cnt_lo + 1))::int;
        if v_is_weekend then
          v_count := greatest(1, floor(v_count * (0.4 + random() * 0.2))::int);
        end if;

        for i in 1..v_count loop
          v_arrival := (v_day::timestamp + (v_peak_hours[1 + floor(random() * array_length(v_peak_hours, 1))::int] + random()) * interval '1 hour') at time zone 'Asia/Kolkata';

          r := random();
          if r < 0.60 then
            v_lane := 'normal';
          elsif r < 0.725 then
            v_lane := 'senior';
          elsif r < 0.85 then
            v_lane := 'pregnant';
          elsif r < 0.95 then
            v_lane := 'appointment';
          else
            v_lane := 'emergency';
          end if;

          if v_lane in ('senior', 'pregnant') then
            v_priority_arg := v_arrival - interval '15 minutes';
          else
            v_priority_arg := v_arrival;
          end if;

          v_patient := null;
          v_walk_in := null;
          if random() < 0.25 then
            select id into v_patient from auth.users
              where email like 'patient%@example.test'
              order by random() limit 1;
          end if;
          if v_patient is null then
            v_walk_in := v_names[1 + floor(random() * array_length(v_names, 1))::int];
          end if;

          -- mint_token always stamps service_day from real now(), so it can't backdate history;
          -- replicate its numbering/code logic directly instead, targeting v_day explicitly.
          insert into private.service_days (service_id, day, last_number)
          values (v_service_id, v_day, 1)
          on conflict (service_id, day) do update set last_number = private.service_days.last_number + 1
          returning last_number into v_num;

          v_lane_rank := case when v_lane = 'emergency' then 0 else 1 end;
          v_code := v_svc.code || '-' || lpad(v_num::text, greatest(3, length(v_num::text)), '0');

          insert into public.tokens (
            org_id, service_id, service_day, number, code, lane, lane_rank, priority_at,
            status, patient_id, walk_in_label, created_at
          ) values (
            v_org, v_service_id, v_day, v_num, v_code, v_lane, v_lane_rank, v_priority_arg,
            'waiting', v_patient, v_walk_in, v_arrival
          )
          returning id into v_tok;

          v_wait := (3 + random() * 20) * interval '1 minute';
          v_called_at := v_arrival + v_wait;

          v_outcome_no_show := random() < 0.08;

          update public.tokens set status = 'called', called_at = v_called_at where id = v_tok;

          if v_outcome_no_show then
            update public.tokens set status = 'no_show' where id = v_tok;
          else
            v_serving_at := v_called_at + (30 + random() * 150) * interval '1 second';
            v_finished_at := v_serving_at + (v_svc.dur_lo + random() * (v_svc.dur_hi - v_svc.dur_lo)) * interval '1 second';
            update public.tokens set status = 'serving', serving_at = v_serving_at where id = v_tok;
            update public.tokens set status = 'done', finished_at = v_finished_at where id = v_tok;
          end if;
        end loop;
      end;
    end loop;
  end loop;
end;
$$;

select private.rebuild_boards(:'org_id', private.service_day(:'org_id', now()));
