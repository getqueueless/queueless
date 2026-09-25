#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

PSQL="docker exec -i supabase-db psql -X -v ON_ERROR_STOP=1 -U postgres -h localhost -d postgres"

$PSQL -q -1 <<'SQL'
do $$
declare
  v_org uuid;
  v_day date;
  v_opd uuid;
  v_ped uuid;
  v_ort uuid;
  v_pha uuid;
  v_counter_a uuid;
  v_counter_b uuid;
  v_tok uuid;
  v_svc uuid;
  v_doctor uuid;
  v_walkin uuid;
  v_receipt_num int;
  v_receipt_id uuid;
  v_first_receipt_id uuid;
  v_finished_a uuid;
  v_finished_b uuid;
  v_finished_c uuid;
  v_patient_demo uuid;
  v_slot uuid;
  v_appt_doctor uuid;
  v_names text[] := array['Asha','Ravi','Priya','Kiran','Meera','Vikram','Sunita','Arjun','Divya','Rohit','Neha','Sanjay','Pooja','Amit','Rekha'];
  i int;
begin
  select id into v_org from public.organizations where slug = 'city-hospital';
  if v_org is null then
    raise exception 'city-hospital organization not found -- run seed.sh first';
  end if;

  v_day := private.service_day(v_org, now());

  select id into v_opd from public.services where org_id = v_org and code = 'OPD';
  select id into v_ped from public.services where org_id = v_org and code = 'PED';
  select id into v_ort from public.services where org_id = v_org and code = 'ORT';
  select id into v_pha from public.services where org_id = v_org and code = 'PHA';

  -- Today's tokens have real dependents now (notifications, cash receipts from the walk-in
  -- desk, doctor-linked appointments, offline-claim rate-limit rows) that a plain `delete from
  -- tokens` doesn't know about and, for some of them, can't even get past -- a real run against
  -- production data hit `notifications_token_id_fkey` (notifications.token_id has no ON DELETE
  -- action, so it blocks). Clear every dependent first, in FK order, org- and day-scoped so
  -- this never touches another org's data or older history:

  -- 1. notifications pointing at today's tokens (private.token_notifications cascades on its
  -- own via ON DELETE CASCADE, but it's cleared explicitly too rather than leaned on silently).
  delete from public.notifications
    where token_id in (select id from public.tokens where org_id = v_org and service_day = v_day);
  delete from private.token_notifications
    where token_id in (select id from public.tokens where org_id = v_org and service_day = v_day);

  -- 2. cash_receipts is append-only by trigger (0041) -- even postgres can't plain DELETE it.
  -- Scoped by the receipts' own org+day, not by joining today's tokens, so it also sweeps up
  -- any already-orphaned (token_id null) rows a pre-fix demo-reset run left behind.
  perform private.demo_reset_cash_receipts(v_org, v_day);

  -- 3. payments, if that table exists yet (owned by a different migration range) -- guarded so
  -- this script keeps working whether or not it's landed. Every payment this script itself
  -- creates (below) is tied to one of today's tokens, so this token-scoped delete always catches
  -- them on the next run.
  if to_regclass('public.payments') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'payments' and column_name = 'token_id'
     )
  then
    execute format(
      'delete from public.payments where token_id in (select id from public.tokens where org_id = %L and service_day = %L)',
      v_org, v_day
    );
  end if;

  -- 4. appointments.token_id is unique with no ON DELETE action -- also blocks. The booking
  -- itself is real history worth keeping (same reasoning as cash_receipts.token_id, which is
  -- ON DELETE SET NULL for exactly this reason), so unlink rather than delete the appointment.
  update public.appointments
    set token_id = null
    where token_id in (select id from public.tokens where org_id = v_org and service_day = v_day);

  -- Demo appointments this script itself books (tomorrow's, below) are its own to clean up on
  -- every run, unlike a real patient's booking -- scoped to the dedicated demo patient account
  -- so this never touches a real booking. Release each slot's booked count first -- a plain
  -- delete would leak capacity forever (never decremented, unlike cancel_appointment's own
  -- path), and every slot would eventually show full on repeat runs.
  select id into v_patient_demo from auth.users where email = 'demo-appointments@lpu.lol';
  if v_patient_demo is not null then
    update public.appointment_slots s
      set booked = greatest(0, s.booked - 1)
      from public.appointments a
      where a.patient_id = v_patient_demo and a.slot_id = s.id and a.status = 'booked';
    delete from public.appointments where patient_id = v_patient_demo;
  end if;

  -- 5. offline-claim rate-limit rows aren't org/day-scoped (private.claim_attempts is keyed
  -- only by patient_id) and exist purely to drive a 1-hour rolling lockout, not as an audit
  -- trail -- clearing the whole table on a demo reset can't leak or lose anything real.
  delete from private.claim_attempts;

  -- clear only today's queue state for this org
  delete from public.tokens where org_id = v_org and service_day = v_day;
  delete from private.service_days
    where day = v_day and service_id in (select id from public.services where org_id = v_org);

  -- ~6 completed visits today with realistic service times, so served_count, avg_service_secs,
  -- the admin charts and the ML training data all have something to show -- run BEFORE any
  -- counter gets pulled into 'serving' below, so a random counter pick here can never collide
  -- with tokens_one_per_desk's "one called/serving token per counter" constraint.
  for i in 1..6 loop
    v_svc := (array[v_opd, v_opd, v_ped, v_ort, v_pha, v_pha])[i];

    select id into v_tok from private.mint_token(
      v_org, v_svc, 'normal', null, v_names[1 + floor(random() * array_length(v_names, 1))::int],
      null, now(), null, null
    );
    select c.id into v_counter_a from public.counter_services cs
      join public.counters c on c.id = cs.counter_id
      where cs.service_id = v_svc
      order by random() limit 1;

    -- backdated so "today" doesn't look like it all happened in the last 10 seconds -- created_at
    -- has no ON DELETE-style constraint tying it to called_at/serving_at, so this is safe.
    update public.tokens set created_at = now() - (30 + floor(random() * 240))::int * interval '1 minute'
      where id = v_tok;
    update public.tokens set status = 'called', counter_id = v_counter_a, called_at = created_at + interval '2 minutes'
      where id = v_tok;
    update public.tokens set status = 'serving', serving_at = called_at + interval '1 minute'
      where id = v_tok;
    update public.tokens set status = 'done', finished_at = serving_at + (180 + floor(random() * 300))::int * interval '1 second'
      where id = v_tok;

    if i = 1 then v_finished_a := v_tok;
    elsif i = 2 then v_finished_b := v_tok;
    elsif i = 3 then v_finished_c := v_tok;
    end if;
  end loop;

  -- 4 cash receipts today (one of them refunded), mirroring staff_register_walkin's own
  -- receipt-numbering logic directly -- that RPC requires a real signed-in staff auth.uid(),
  -- which this script doesn't have.
  v_first_receipt_id := null;
  for i in 1..4 loop
    v_svc := (array[v_opd, v_ped, v_ort, v_pha])[i];
    select id into v_doctor from public.doctors where service_id = v_svc and active order by random() limit 1;

    insert into public.walkin_patients (org_id, phone, full_name, date_of_birth, gender, city)
    values (
      v_org, '+9198765' || lpad((40000 + i)::text, 5, '0'),
      v_names[1 + floor(random() * array_length(v_names, 1))::int],
      (current_date - ((20 + i * 7) || ' years')::interval)::date,
      (array['male', 'female']::public.gender[])[1 + floor(random() * 2)::int], 'Ludhiana'
    )
    on conflict (org_id, phone) do update set full_name = excluded.full_name
    returning id into v_walkin;

    select id into v_tok from private.mint_token(v_org, v_svc, 'normal', null, 'Cash desk walk-in', null, now(), null, v_doctor);
    update public.tokens
      set walkin_patient_id = v_walkin, status = 'called', counter_id = null, called_at = now()
      where id = v_tok;
    update public.tokens set status = 'serving', serving_at = now() where id = v_tok;
    update public.tokens set status = 'done', finished_at = now() where id = v_tok;

    insert into private.cash_receipt_days (org_id, day, last_number)
    values (v_org, v_day, 1)
    on conflict (org_id, day) do update set last_number = private.cash_receipt_days.last_number + 1
    returning last_number into v_receipt_num;

    insert into public.cash_receipts (org_id, token_id, patient_phone, doctor_id, amount_inr, receipt_no, collected_by)
    values (
      v_org, v_tok, '+9198765' || lpad((40000 + i)::text, 5, '0'), v_doctor,
      coalesce((select fee_inr from public.doctors where id = v_doctor), 300),
      'R-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_receipt_num::text, 4, '0'),
      (select id from auth.users where email = 'counter1@lpu.lol')
    )
    returning id into v_receipt_id;

    if i = 1 then v_first_receipt_id := v_receipt_id; end if;
  end loop;

  -- refund the first of the 4 (append-only ledger, so a refund is its own new row, negative,
  -- pointing back at the original -- same shape admin_refund_cash_receipt writes).
  if v_first_receipt_id is not null then
    insert into private.cash_receipt_days (org_id, day, last_number)
    values (v_org, v_day, 1)
    on conflict (org_id, day) do update set last_number = private.cash_receipt_days.last_number + 1
    returning last_number into v_receipt_num;

    insert into public.cash_receipts (org_id, token_id, patient_phone, doctor_id, amount_inr, receipt_no, collected_by, refund_of, reason)
    select org_id, token_id, patient_phone, doctor_id, -amount_inr,
      'R-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_receipt_num::text, 4, '0'),
      collected_by, id, 'Demo refund'
    from public.cash_receipts where id = v_first_receipt_id;
  end if;

  -- 2 captured online payments + 1 refunded, tied to 3 of the finished visits above. Those
  -- tokens are minted with no doctor (a plain walk-in service visit), so there's no real fee to
  -- copy -- a flat realistic amount stands in, same as the cash desk fixtures' own fallback.
  if to_regclass('public.payments') is not null and v_finished_a is not null then
    insert into public.payments (org_id, token_id, razorpay_order_id, razorpay_payment_id, amount_inr, status, captured_at)
    values (v_org, v_finished_a, 'order_demo_' || v_finished_a, 'pay_demo_' || v_finished_a, 450, 'captured', now());
  end if;
  if to_regclass('public.payments') is not null and v_finished_b is not null then
    insert into public.payments (org_id, token_id, razorpay_order_id, razorpay_payment_id, amount_inr, status, captured_at)
    values (v_org, v_finished_b, 'order_demo_' || v_finished_b, 'pay_demo_' || v_finished_b, 600, 'captured', now());
  end if;
  if to_regclass('public.payments') is not null and v_finished_c is not null then
    insert into public.payments (org_id, token_id, razorpay_order_id, razorpay_payment_id, razorpay_refund_id, amount_inr, status, captured_at, refunded_at, refund_reason)
    values (
      v_org, v_finished_c, 'order_demo_' || v_finished_c, 'pay_demo_' || v_finished_c, 'rfnd_demo_' || v_finished_c,
      500, 'refunded', now() - interval '20 minutes', now(), 'Demo refund'
    );
  end if;

  -- ~15 waiting tokens spread across the 4 services, mostly normal lane. Roughly a third are
  -- assigned to a specific active doctor for that service (doctor-bound queue), the rest stay
  -- doctor_id null ("any available doctor") -- so the demo actually shows both queue types.
  for i in 1..15 loop
    v_svc := (array[v_opd, v_opd, v_opd, v_ped, v_ped, v_ort, v_pha, v_pha])[1 + floor(random() * 8)::int];

    v_doctor := null;
    if random() < 0.35 then
      select id into v_doctor from public.doctors
        where service_id = v_svc and active
        order by random() limit 1;
    end if;

    select id into v_tok from private.mint_token(
      v_org,
      v_svc,
      (case
        when i = 1 then 'appointment'
        when i in (2, 3) then (array['senior', 'pregnant'])[1 + floor(random() * 2)::int]
        else 'normal'
      end)::public.lane,
      null,
      v_names[1 + floor(random() * array_length(v_names, 1))::int],
      null,
      now(),
      null,
      v_doctor
    );
  end loop;

  -- pull 2 tokens onto 2 open counters and take them into serving, right now (not backdated --
  -- a called token older than services.no_show_minutes auto-flips to no_show on its own)
  select id into v_counter_a from public.counters
    where org_id = v_org and state = 'open' order by name limit 1;
  select id into v_counter_b from public.counters
    where org_id = v_org and state = 'open' and id <> v_counter_a order by name limit 1;

  if v_counter_a is not null then
    select id into v_tok from public.tokens t
      where t.org_id = v_org and t.service_day = v_day and t.status = 'waiting'
        and t.service_id in (select cs.service_id from public.counter_services cs where cs.counter_id = v_counter_a)
      order by t.lane_rank, t.priority_at, t.number limit 1;
    if v_tok is not null then
      update public.tokens set status = 'called', counter_id = v_counter_a, called_at = now() where id = v_tok;
      update public.tokens set status = 'serving', serving_at = now() where id = v_tok;
    end if;
  end if;

  if v_counter_b is not null then
    select id into v_tok from public.tokens t
      where t.org_id = v_org and t.service_day = v_day and t.status = 'waiting'
        and t.service_id in (select cs.service_id from public.counter_services cs where cs.counter_id = v_counter_b)
      order by t.lane_rank, t.priority_at, t.number limit 1;
    if v_tok is not null then
      update public.tokens set status = 'called', counter_id = v_counter_b, called_at = now() where id = v_tok;
      update public.tokens set status = 'serving', serving_at = now() where id = v_tok;
    end if;
  end if;

  -- upcoming appointments: a dedicated demo patient account (never a real signed-up user -- see
  -- the cleanup above), 3 bookings across different services/doctors, each the soonest open slot
  -- in the coming week (usually tomorrow; see the generate_doctor_slots call below for why not
  -- always literally tomorrow). book_appointment's own auth.uid() check can't run here, so this
  -- mirrors its insert + slot-capacity bump directly.
  insert into auth.users (id, email)
  select gen_random_uuid(), 'demo-appointments@lpu.lol'
  where not exists (select 1 from auth.users where email = 'demo-appointments@lpu.lol');
  select id into v_patient_demo from auth.users where email = 'demo-appointments@lpu.lol';
  update public.profiles
    set full_name = coalesce(full_name, 'Demo Appointments Patient'), profile_completed_at = coalesce(profile_completed_at, now())
    where id = v_patient_demo;

  for i in 1..3 loop
    v_svc := (array[v_opd, v_ped, v_ort])[i];
    select d.id into v_appt_doctor from public.doctors d where d.service_id = v_svc and d.active order by random() limit 1;
    -- a whole week out, not just literally tomorrow: doctor_schedules only covers Mon-Sat
    -- (seed data), so "tomorrow" landing on a Sunday would otherwise silently generate zero
    -- slots for that doctor and skip this booking every 7th run.
    perform private.generate_doctor_slots(v_appt_doctor, v_day + 1, v_day + 7);

    select id into v_slot from public.appointment_slots
      where service_id = v_svc and doctor_id = v_appt_doctor and booked < capacity
        and starts_at::date > v_day
      order by starts_at limit 1;

    if v_slot is not null then
      insert into public.appointments (slot_id, service_id, patient_id, status, doctor_id)
      values (v_slot, v_svc, v_patient_demo, 'booked', v_appt_doctor);
      update public.appointment_slots set booked = booked + 1 where id = v_slot;
    end if;
  end loop;

  perform private.rebuild_boards(v_org, v_day);

  -- keep the "one running late, one on leave" doctors demo-fresh no matter which calendar day
  -- this actually runs on -- doctor_status falls back to 'available' once its `day` is stale,
  -- and a doctor_leaves row is a fixed date range, so both need restamping to today, same as
  -- the live queue above.
  update public.doctor_status ds
    set status = 'running_late', late_minutes = 20, day = v_day, updated_at = now()
    from public.doctors d
    where d.id = ds.doctor_id and d.org_id = v_org and d.name = 'Dr. Neha Sharma';

  update public.doctor_leaves dl
    set from_date = v_day, to_date = v_day + 1
    from public.doctors d
    where d.id = dl.doctor_id and d.org_id = v_org and d.name = 'Dr. Kavita Reddy';

  update public.doctor_status ds
    set status = 'off', late_minutes = null, day = v_day, updated_at = now()
    from public.doctors d
    where d.id = ds.doctor_id and d.org_id = v_org and d.name = 'Dr. Kavita Reddy';
end;
$$;
SQL

echo "Live queue reset. Today's snapshot:"
$PSQL -tA -F' | ' -c "
  select s.code, bs.waiting_count, bs.served_count, bs.no_show_count
  from public.board_services bs
  join public.services s on s.id = bs.service_id
  join public.organizations o on o.id = bs.org_id
  where o.slug = 'city-hospital' and bs.day = private.service_day(o.id, now())
  order by s.code;
"
echo "code | waiting | served | no_show (printed above, per service)"
$PSQL -tA -c "
  select count(*) from public.tokens t
  join public.organizations o on o.id = t.org_id
  where o.slug = 'city-hospital' and t.status = 'serving' and t.service_day = private.service_day(o.id, now());
" | xargs -I{} echo "Currently serving: {} tokens"
