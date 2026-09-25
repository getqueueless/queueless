-- claim_offline_token returns a (token, error_code, retry_after) row and never raises for a
-- claim-specific outcome (see 0042's own comment for why -- a RAISE would roll back the very
-- attempt-log/audit rows this feature needs to persist on failure). Only two true
-- preconditions -- not_signed_in, profile_incomplete -- still raise, since there's nothing to
-- lose by rolling those back.
begin;
select plan(17);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000170', 't-170', 'Claim Org 170', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day) values
  ('c0000000-0000-0000-0000-000000000170', 'a0000000-0000-0000-0000-000000000170', 'A', 'Desk A', true, 500),
  ('c0000000-0000-0000-0000-000000000171', 'a0000000-0000-0000-0000-000000000170', 'B', 'Desk B', true, 500);
insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000170', 'staff170@queueless.test');
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000170' where id = '11100000-0000-0000-0000-000000000170';

-- Not signed in / incomplete profile: these two are true preconditions, still a hard raise.
select throws_ok(
  $$ select public.claim_offline_token('X-001') $$,
  'PGRST', null, 'an anonymous caller is refused before any lookup (still raises -- true precondition)'
);

insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000173', 'nopatient170@queueless.test');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000173', 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select public.claim_offline_token('X-001') $$,
  'PGRST', null, 'a caller with no completed profile is refused before any lookup (still raises)'
);
reset role;

-- The patient trying to claim, with a completed profile whose phone matches the walk-in's.
insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000171', 'patient170@queueless.test');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000171', 'role', 'authenticated')::text, true);
select public.complete_my_profile('Gurpreet Singh', '+919876511111', '1988-05-05', 'male', 'Ludhiana');
reset role;

-- Register the matching walk-in at the desk.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000170', 'role', 'authenticated')::text, true);
create temp table tok170 as select * from public.staff_register_walkin(
  'Gurpreet Singh', '+919876511111', '1988-05-05', 'male', 'Ludhiana', 'c0000000-0000-0000-0000-000000000170'
);
grant select on tok170 to public;
reset role;

-- Wrong code: generic claim_failed, no exception, no hint either way.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000171', 'role', 'authenticated')::text, true);
select is((public.claim_offline_token('Z-999')).error_code, 'claim_failed', 'a code that does not exist gives the generic claim_failed, no exception');

-- Right code, right phone: succeeds, error_code is null, links patient_id.
select is(
  ((public.claim_offline_token((select code from tok170))).token).patient_id,
  '11100000-0000-0000-0000-000000000171'::uuid,
  'the matching code+phone claims the token and links patient_id'
);
reset role;

select is(
  (select patient_id from public.tokens where id = (select id from tok170)),
  '11100000-0000-0000-0000-000000000171'::uuid, 'the link actually persisted (checked as postgres)'
);

-- Claiming again: already claimed (patient_id no longer null) -> 0 eligible candidates ->
-- generic claim_failed, not a different error that would reveal it was already claimed.
insert into auth.users (id, email) values ('11100000-0000-0000-0000-000000000172', 'patient170b@queueless.test');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000172', 'role', 'authenticated')::text, true);
select public.complete_my_profile('Someone Else', '+919876522222', '1992-02-02', 'other', 'Patiala');
select is(
  (public.claim_offline_token((select code from tok170))).error_code,
  'claim_failed', 'an already-claimed code fails the same generic way'
);
reset role;

-- Phone mismatch: right code, wrong caller phone -> same generic claim_failed.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000170', 'role', 'authenticated')::text, true);
create temp table tok170b as select * from public.staff_register_walkin(
  'Another Patient', '+919876533333', '1970-01-01', 'female', 'Amritsar', 'c0000000-0000-0000-0000-000000000171'
);
grant select on tok170b to public;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000172', 'role', 'authenticated')::text, true);
select is(
  (public.claim_offline_token((select code from tok170b))).error_code,
  'claim_failed', 'the right code with the wrong caller phone fails the same generic way'
);
reset role;

-- The whole point of this migration: the two failures above actually persisted, since
-- claim_offline_token never raises for a claim-specific outcome.
select is(
  (select count(*) from private.claim_attempts where patient_id = '11100000-0000-0000-0000-000000000172'),
  2::bigint, 'both failed attempts (already-claimed, phone-mismatch) really were recorded'
);
select is(
  (select count(*) from public.audit_log where action like 'claim_offline_token%'),
  4::bigint, 'every attempt -- 1 success, 3 failures so far -- has its own audit_log row, all durable'
);

-- Rate limit: 3 more failures push this same account to 5, the 6th is blocked before it even
-- tries to look anything up, and reports a Retry-After.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000172', 'role', 'authenticated')::text, true);
select is((public.claim_offline_token('Z-001')).error_code, 'claim_failed', 'failure 3 of 5');
select is((public.claim_offline_token('Z-002')).error_code, 'claim_failed', 'failure 4 of 5');
select is((public.claim_offline_token('Z-003')).error_code, 'claim_failed', 'failure 5 of 5');
select is(
  (public.claim_offline_token('Z-004')).error_code, 'too_many_attempts',
  'the 6th attempt in an hour is rate-limited instead of looked up at all'
);
select is(
  (public.claim_offline_token('Z-005')).retry_after, 3600, 'the lockout reports a Retry-After'
);
reset role;

select is(
  (select count(*) from private.claim_attempts where patient_id = '11100000-0000-0000-0000-000000000172'),
  5::bigint, 'the rate-limit bounce itself is not logged as a 6th/7th attempt -- it would extend the lockout forever'
);

-- caller's active-token limit still applies, even when it's a DIFFERENT active token (not the
-- one this claim would produce): Gurpreet gets an ordinary walk-up token for service B (no
-- walk-in desk involved), then a walk-in ticket for that SAME service B, matching Gurpreet's own
-- phone, is registered separately. The walk-in desk's own already_active guard is keyed on
-- (walkin_patient_id, service_id), not on the patient's other tokens, so that registration
-- succeeds -- and claim_offline_token is the thing that must then refuse the claim.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000171', 'role', 'authenticated')::text, true);
select public.issue_token('c0000000-0000-0000-0000-000000000171');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000170', 'role', 'authenticated')::text, true);
create temp table tok170c as select * from public.staff_register_walkin(
  'Gurpreet Singh', '+919876511111', '1988-05-05', 'male', 'Ludhiana', 'c0000000-0000-0000-0000-000000000171'
);
grant select on tok170c to public;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11100000-0000-0000-0000-000000000171', 'role', 'authenticated')::text, true);
select is(
  (public.claim_offline_token((select code from tok170c))).error_code,
  'already_active', 'the caller''s own active-token limit for that service still applies to a claim'
);
reset role;

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
       and p.proname like '%claim%'
       and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon can execute nothing claim-related'
);

select * from finish(true);
rollback;
