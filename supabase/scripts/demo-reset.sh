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
  -- this script keeps working whether or not it's landed.
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

  -- 5. offline-claim rate-limit rows aren't org/day-scoped (private.claim_attempts is keyed
  -- only by patient_id) and exist purely to drive a 1-hour rolling lockout, not as an audit
  -- trail -- clearing the whole table on a demo reset can't leak or lose anything real.
  delete from private.claim_attempts;

  -- clear only today's queue state for this org
  delete from public.tokens where org_id = v_org and service_day = v_day;
  delete from private.service_days
    where day = v_day and service_id in (select id from public.services where org_id = v_org);

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
