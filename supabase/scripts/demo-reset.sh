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

  -- clear only today's queue state for this org
  delete from public.tokens where org_id = v_org and service_day = v_day;
  delete from private.service_days
    where day = v_day and service_id in (select id from public.services where org_id = v_org);

  -- ~15 waiting tokens spread across the 4 services, mostly normal lane
  for i in 1..15 loop
    select id into v_tok from private.mint_token(
      v_org,
      (array[v_opd, v_opd, v_opd, v_ped, v_ped, v_ort, v_pha, v_pha])[1 + floor(random() * 8)::int],
      (case
        when i = 1 then 'appointment'
        when i in (2, 3) then (array['senior', 'pregnant'])[1 + floor(random() * 2)::int]
        else 'normal'
      end)::public.lane,
      null,
      v_names[1 + floor(random() * array_length(v_names, 1))::int],
      null,
      now(),
      null
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
