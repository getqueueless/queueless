begin;
select plan(9);

insert into public.organizations (id, slug, name, timezone)
values
  ('44444444-4444-4444-4444-4444444444b0', 't-090a', 'Role Org A', 'UTC'),
  ('44444444-4444-4444-4444-4444444444b1', 't-090b', 'Role Org B', 'UTC');

insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000e1', 'p090admin@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000e2', 'p090patient@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000e3', 'p090orgb@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000e4', 'p090admin2@queueless.test');

update public.profiles set role = 'admin', org_id = '44444444-4444-4444-4444-4444444444b0'
  where id = '55555555-0000-0000-0000-0000000000e1';
update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-4444444444b1'
  where id = '55555555-0000-0000-0000-0000000000e3';

create or replace function pg_temp.try_set_role(
  p_user uuid, p_role public.user_role, p_org uuid,
  out ok boolean, out err_code text, out prof public.profiles
) as $$
declare v_message text;
begin
  ok := true;
  begin
    prof := public.set_member_role(p_user, p_role, p_org);
  exception when sqlstate 'PGRST' then
    ok := false;
    get stacked diagnostics v_message = message_text;
    err_code := v_message::jsonb ->> 'code';
  end;
end;
$$ language plpgsql;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-0000000000e2', 'role', 'authenticated')::text, true);

create temp table r0 as select * from pg_temp.try_set_role('55555555-0000-0000-0000-0000000000e2', 'staff', '44444444-4444-4444-4444-4444444444b0');
select is(r0.err_code, 'forbidden', 'a non-admin cannot set anyone''s role') from r0;

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-0000000000e1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- promote a fresh patient (org_id is null) to staff of the admin's own org
create temp table r1 as select * from pg_temp.try_set_role('55555555-0000-0000-0000-0000000000e2', 'staff', '44444444-4444-4444-4444-4444444444b0');
select is(r1.ok, true, 'admin can promote a patient to staff in their own org') from r1;
select is((r1.prof).role, 'staff'::public.user_role, 'role becomes staff') from r1;
select is((r1.prof).org_id, '44444444-4444-4444-4444-4444444444b0'::uuid, 'org_id is set to the admin''s org') from r1;

-- admin of org A cannot touch a member already in org B
create temp table r2 as select * from pg_temp.try_set_role('55555555-0000-0000-0000-0000000000e3', 'staff', '44444444-4444-4444-4444-4444444444b0');
select is(r2.err_code, 'forbidden', 'an admin cannot reassign a staff member who already belongs to a different org') from r2;

-- demote back to patient clears org_id
create temp table r3 as select * from pg_temp.try_set_role('55555555-0000-0000-0000-0000000000e2', 'patient', '44444444-4444-4444-4444-4444444444b0');
select is((r3.prof).org_id is null, true, 'demoting to patient clears org_id') from r3;

-- e1 is currently the org's only admin -- cannot demote themselves
create temp table r4 as select * from pg_temp.try_set_role('55555555-0000-0000-0000-0000000000e1', 'staff', '44444444-4444-4444-4444-4444444444b0');
select is(r4.err_code, 'illegal_transition', 'the org''s sole admin cannot demote themselves') from r4;

-- promote e4 to a second admin, then the demotion is fine
create temp table promote as select * from pg_temp.try_set_role('55555555-0000-0000-0000-0000000000e4', 'admin', '44444444-4444-4444-4444-4444444444b0');
select is(promote.ok, true, 'promoting a second admin succeeds') from promote;

create temp table r5 as select * from pg_temp.try_set_role('55555555-0000-0000-0000-0000000000e1', 'staff', '44444444-4444-4444-4444-4444444444b0');
select is(r5.ok, true, 'demoting an admin is fine once another admin remains') from r5;

reset role;

select * from finish(true);
rollback;
