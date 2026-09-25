begin;
select plan(4);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000150', 't-150', 'Wait Est Org', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000150', 'a0000000-0000-0000-0000-000000000150', 'A', 'Desk A', true, 500);
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr) values
  ('f0000000-0000-0000-0000-000000000150', 'a0000000-0000-0000-0000-000000000150', 'c0000000-0000-0000-0000-000000000150', 'Dr. Y', 'Gen', 200);
insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000150', 'admin150@queueless.test');
update public.profiles set role = 'admin', org_id = 'a0000000-0000-0000-0000-000000000150' where id = '11100000-0000-0000-0000-000000000150';

create temp table tok150 as select * from private.mint_token(
  'a0000000-0000-0000-0000-000000000150', 'c0000000-0000-0000-0000-000000000150', 'normal',
  null, 'W1', null, now(), null, 'f0000000-0000-0000-0000-000000000150'
);
update public.tokens set status = 'called', called_at = now() where id = (select id from tok150);
update public.tokens set status = 'serving', serving_at = now() where id = (select id from tok150);
update public.tokens set status = 'done', finished_at = now() + interval '5 minutes' where id = (select id from tok150);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000150', 'role', 'authenticated')::text, true);

select is(
  (select avg_service_minutes from analytics.doctor_service_time('a0000000-0000-0000-0000-000000000150', 'f0000000-0000-0000-0000-000000000150', 30)),
  5.0::numeric, 'doctor_service_time averages the one done token''s 5-minute service time'
);
select is(
  (select sample_count from analytics.doctor_service_time('a0000000-0000-0000-0000-000000000150', 'f0000000-0000-0000-0000-000000000150', 30)),
  1::bigint, 'sample_count reflects the one sample'
);
reset role;

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace = 'analytics'::regnamespace
       and p.proname = 'doctor_service_time'
       and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon cannot call doctor_service_time'
);

insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000151', 'staff150@queueless.test');
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000150' where id = '11100000-0000-0000-0000-000000000151';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000151', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select * from analytics.doctor_service_time('a0000000-0000-0000-0000-000000000150', 'f0000000-0000-0000-0000-000000000150', 30) $$,
  'PGRST', null, 'staff (not admin) is forbidden from doctor_service_time too'
);
reset role;

select * from finish(true);
rollback;
