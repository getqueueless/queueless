begin;
select plan(16);

insert into public.organizations (id, slug, name, timezone, priority_head_start_minutes)
values ('44444444-4444-4444-4444-444444444460', 't-060', 'Priority Org', 'UTC', 15);

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('bbbbbbbb-0000-0000-0000-000000000051', '44444444-4444-4444-4444-444444444460', 'G', 'General', true, 3),
  ('bbbbbbbb-0000-0000-0000-000000000052', '44444444-4444-4444-4444-444444444460', 'P', 'Peds', true, 500);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000051', 'p060staff@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000052', 'p060patient@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000053', 'p060rando@queueless.test');
update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-444444444460'
  where id = '55555555-0000-0000-0000-000000000051';

create or replace function pg_temp.try_staff_issue(
  p_service uuid, p_lane public.lane, p_label text, p_patient uuid,
  out ok boolean, out err_code text, out tok public.tokens
) as $$
declare v_message text;
begin
  ok := true;
  begin
    tok := public.staff_issue_token(p_service, p_lane, p_label, p_patient);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

create or replace function pg_temp.try_verify(
  p_token uuid, p_status public.lane,
  out ok boolean, out err_code text, out tok public.tokens
) as $$
declare v_message text;
begin
  ok := true;
  begin
    tok := public.verify_priority(p_token, p_status);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000053', 'role', 'authenticated')::text, true);

-- non-staff cannot staff-issue
create temp table i0 as select * from pg_temp.try_staff_issue('bbbbbbbb-0000-0000-0000-000000000051', 'emergency', 'W1', null);
select is(i0.err_code, 'forbidden', 'non-staff cannot staff-issue a token') from i0;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000051', 'role', 'authenticated')::text, true);
set local role authenticated;

-- emergency bypasses the daily cap (cap is 3; fill it with normal walk-ins first)
create temp table i1 as select * from pg_temp.try_staff_issue('bbbbbbbb-0000-0000-0000-000000000051', 'normal', 'W1', null);
create temp table i2 as select * from pg_temp.try_staff_issue('bbbbbbbb-0000-0000-0000-000000000051', 'normal', 'W2', null);
create temp table i3 as select * from pg_temp.try_staff_issue('bbbbbbbb-0000-0000-0000-000000000051', 'normal', 'W3', null);
select is(i3.ok, true, 'cap fully used by normal walk-ins') from i3;
create temp table i4 as select * from pg_temp.try_staff_issue('bbbbbbbb-0000-0000-0000-000000000051', 'emergency', 'E1', null);
select is(i4.ok, true, 'emergency staff-issue bypasses the daily cap') from i4;
select is((i4.tok).lane_rank, 0::smallint, 'emergency gets lane_rank 0') from i4;

-- staff issues a walk-in for a real patient (separate service, uncapped)
create temp table i5 as select * from pg_temp.try_staff_issue('bbbbbbbb-0000-0000-0000-000000000052', 'normal', null, '55555555-0000-0000-0000-000000000052');
select is(i5.ok, true, 'staff can issue a token on behalf of a real patient') from i5;

reset role;

-- forbidden: random signed-in user cannot verify priority
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000053', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table v0 as select * from pg_temp.try_verify((select (tok).id from i5), 'senior');
select is(v0.err_code, 'forbidden', 'non-staff cannot verify priority') from v0;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000051', 'role', 'authenticated')::text, true);
set local role authenticated;

-- lane_not_allowed: can't "verify" someone as emergency
create temp table v1 as select * from pg_temp.try_verify((select (tok).id from i5), 'emergency');
select is(v1.err_code, 'lane_not_allowed', 'emergency is not a verifiable priority status') from v1;

-- not_found
create temp table v2 as select * from pg_temp.try_verify('00000000-0000-0000-0000-000000000099', 'senior');
select is(v2.err_code, 'not_found', 'verifying a nonexistent token is not_found') from v2;

-- happy path: verify a real patient's waiting token as senior
create temp table v3 as select * from pg_temp.try_verify((select (tok).id from i5), 'senior');
select is(v3.ok, true, 'staff can verify a waiting token') from v3;
select is((v3.tok).lane, 'senior'::public.lane, 'token lane becomes senior') from v3;
select is((v3.tok).lane_rank, 1::smallint, 'lane_rank stays 1 for senior (not emergency)') from v3;
select is(
  (v3.tok).priority_at,
  (select created_at - interval '15 minutes' from public.tokens where id = (select (tok).id from i5)),
  'priority_at pulled to created_at minus the org head start'
) from v3;

-- DB-state check, not an RLS-visibility check: profiles has real RLS now (staff only see a
-- profile in their own org, and a patient's profile has no org_id at all), so this reads back as
-- postgres, same as every other "did the RPC's side effect actually land" check in this suite.
reset role;
select is(
  (select priority_status from public.profiles where id = '55555555-0000-0000-0000-000000000052'),
  'senior'::public.lane,
  'the patient profile records the verified priority status'
);
select is(
  (select priority_verified_by from public.profiles where id = '55555555-0000-0000-0000-000000000052'),
  '55555555-0000-0000-0000-000000000051'::uuid,
  'the profile records which staff member verified it'
);

-- walk-in ticket (no patient_id) can still be verified without crashing
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000051', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table v4 as select * from pg_temp.try_verify((select (tok).id from i4), 'pregnant');
select is(v4.ok, true, 'a walk-in ticket with no linked profile can still be verified') from v4;
select is((v4.tok).lane, 'pregnant'::public.lane, 'walk-in token lane updates too') from v4;

reset role;

select * from finish(true);
rollback;
