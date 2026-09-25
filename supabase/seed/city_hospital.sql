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
-- (doctor_id left null -- "any available doctor"). 0039 dropped the old unique(service_id,
-- starts_at) in favor of unique(doctor_id, starts_at) where doctor_id is not null, so a
-- doctor_id-is-null row like this one has no constraint to ON CONFLICT against any more --
-- guard with not exists instead, same as the counters insert above.
insert into public.appointment_slots (service_id, starts_at, capacity)
select
  s.id,
  gen.starts_at,
  2
from public.services s
cross join lateral (
  select ((private.service_day(:'org_id', now()) + day_offset)::timestamp
    + interval '9 hours' + (slot_n * 15) * interval '1 minute') at time zone 'Asia/Kolkata' as starts_at
  from generate_series(0, 1) as day_offset
  cross join generate_series(0, 32) as slot_n -- 09:00 to 17:00 inclusive, 15-min steps
) as gen
where s.org_id = :'org_id'
  and not exists (
    select 1 from public.appointment_slots a
    where a.service_id = s.id and a.starts_at = gen.starts_at and a.doctor_id is null
  );

-- doctors: 2-3 per service, realistic Indian names/specialties, a morning + an evening shift
-- each. Guarded on (org, name) since doctors has no natural unique key of its own. One doctor
-- (Dr. Kavita Reddy, ORT) is on leave today via doctor_leaves; one (Dr. Neha Sharma, OPD) is
-- running_late via doctor_status -- both picked to show up on the patient-facing status view.
select set_config('queueless.seed_org_id', :'org_id', false);

do $$
declare
  v_org uuid := current_setting('queueless.seed_org_id')::uuid;
  v_day date := private.service_day(v_org, now());
  v_svc_id uuid;
  v_doctor_id uuid;
  v_doctor record;
  v_doctors jsonb := '[
    {"service":"OPD","name":"Dr. Neha Sharma","specialty":"General Medicine","qualification":"MBBS, MD","room":"OPD-101","fee_inr":300},
    {"service":"OPD","name":"Dr. Rajesh Iyer","specialty":"General Medicine","qualification":"MBBS","room":"OPD-102","fee_inr":250},
    {"service":"OPD","name":"Dr. Farah Sheikh","specialty":"Internal Medicine","qualification":"MBBS, MD","room":"OPD-103","fee_inr":350},
    {"service":"PED","name":"Dr. Priya Nair","specialty":"Pediatrics","qualification":"MBBS, DCH","room":"PED-201","fee_inr":320},
    {"service":"PED","name":"Dr. Arjun Menon","specialty":"Pediatrics","qualification":"MBBS, MD","room":"PED-202","fee_inr":300},
    {"service":"ORT","name":"Dr. Kavita Reddy","specialty":"Orthopedics","qualification":"MBBS, MS Ortho","room":"ORT-301","fee_inr":400},
    {"service":"ORT","name":"Dr. Sandeep Kulkarni","specialty":"Orthopedics","qualification":"MBBS, MS Ortho","room":"ORT-302","fee_inr":380},
    {"service":"PHA","name":"Dr. Meera Joshi","specialty":"Clinical Pharmacology","qualification":"B.Pharm, PharmD","room":"PHA-401","fee_inr":150}
  ]';
begin
  for v_doctor in select * from jsonb_to_recordset(v_doctors)
    as x(service text, name text, specialty text, qualification text, room text, fee_inr int)
  loop
    select id into v_svc_id from public.services where org_id = v_org and code = v_doctor.service;

    select id into v_doctor_id from public.doctors
      where org_id = v_org and service_id = v_svc_id and name = v_doctor.name;

    if v_doctor_id is null then
      insert into public.doctors (org_id, service_id, name, specialty, qualification, room, fee_inr)
      values (v_org, v_svc_id, v_doctor.name, v_doctor.specialty, v_doctor.qualification, v_doctor.room, v_doctor.fee_inr)
      returning id into v_doctor_id;

      -- morning (09:00-13:00) and evening (17:00-20:00) shifts, Mon-Sat (weekday 1-6)
      insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, max_patients, slot_minutes)
      select v_doctor_id, w, '09:00'::time, '13:00'::time, 16, 15 from generate_series(1, 6) as w
      union all
      select v_doctor_id, w, '17:00'::time, '20:00'::time, 12, 15 from generate_series(1, 6) as w;

      -- a lunch break inside the gap between shifts is redundant, so give every doctor a short
      -- mid-morning break instead, inside the morning shift, so slot generation has one to skip
      insert into public.doctor_breaks (doctor_id, weekday, start_time, end_time)
      select v_doctor_id, w, '11:00'::time, '11:15'::time from generate_series(1, 6) as w;

      perform private.generate_doctor_slots(v_doctor_id, v_day, v_day + 1);
    end if;
  end loop;

  -- one doctor on leave today (and tomorrow, so the demo doesn't need re-running at midnight).
  -- doctor_leaves is what actually blocks slot generation; doctor_status is a separate,
  -- staff-set flag doctor_status_today doesn't derive from it, so set both -- otherwise the
  -- demo's patient-facing status view would still read this doctor back as "available".
  select d.id into v_doctor_id from public.doctors d
    where d.org_id = v_org and d.name = 'Dr. Kavita Reddy';
  if not exists (select 1 from public.doctor_leaves where doctor_id = v_doctor_id and from_date <= v_day and to_date >= v_day) then
    insert into public.doctor_leaves (doctor_id, from_date, to_date, reason)
    values (v_doctor_id, v_day, v_day + 1, 'Conference');
  end if;
  update public.doctor_status
    set status = 'off', late_minutes = null, day = v_day, updated_at = now()
    where doctor_id = v_doctor_id;

  -- one doctor running 20 minutes late today (doctor_status_today falls back to 'available'
  -- once `day` rolls past, so this only ever shows as late on the day it was set)
  select d.id into v_doctor_id from public.doctors d
    where d.org_id = v_org and d.name = 'Dr. Neha Sharma';
  update public.doctor_status
    set status = 'running_late', late_minutes = 20, day = v_day, updated_at = now()
    where doctor_id = v_doctor_id;
end;
$$;

-- 14 days of synthetic history, oldest first, guarded so a rerun never doubles it

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
