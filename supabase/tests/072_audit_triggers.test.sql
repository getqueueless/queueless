begin;
select plan(10);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444490', 't-072', 'Audit Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-0000000000b1', '44444444-4444-4444-4444-444444444490', 'G', 'General', true, 500);

select is(
  (select count(*)::int from public.audit_log where entity = 'services' and entity_id = 'bbbbbbbb-0000-0000-0000-0000000000b1'),
  1, 'inserting a service logs one audit row'
);

update public.services set name = 'General OPD' where id = 'bbbbbbbb-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.audit_log where entity = 'services' and entity_id = 'bbbbbbbb-0000-0000-0000-0000000000b1'),
  2, 'updating a service adds a second audit row'
);

insert into public.counters (id, org_id, name, state)
values ('cccccccc-0000-0000-0000-0000000000b1', '44444444-4444-4444-4444-444444444490', 'Desk 1', 'closed');

select is(
  (select count(*)::int from public.audit_log where entity = 'counters' and entity_id = 'cccccccc-0000-0000-0000-0000000000b1'),
  1, 'inserting a counter logs an audit row'
);
select is(
  (select counter_name from public.board_counters where counter_id = 'cccccccc-0000-0000-0000-0000000000b1'),
  'Desk 1', 'creating a counter auto-creates its board_counters row'
);

update public.counters set state = 'open' where id = 'cccccccc-0000-0000-0000-0000000000b1';
select is(
  (select state from public.board_counters where counter_id = 'cccccccc-0000-0000-0000-0000000000b1'),
  'open'::public.counter_state, 'updating a counter refreshes its board_counters state'
);

insert into public.counter_services (counter_id, service_id)
values ('cccccccc-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from public.audit_log where entity = 'counter_services' and entity_id = 'cccccccc-0000-0000-0000-0000000000b1'),
  1, 'linking a counter to a service logs an audit row'
);

delete from public.counter_services where counter_id = 'cccccccc-0000-0000-0000-0000000000b1' and service_id = 'bbbbbbbb-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.audit_log where entity = 'counter_services' and entity_id = 'cccccccc-0000-0000-0000-0000000000b1' and action = 'DELETE'),
  1, 'unlinking a counter from a service logs an audit row too'
);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000b1', 'p072@queueless.test');
update public.profiles set full_name = 'Renamed' where id = '55555555-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.audit_log where entity = 'profiles' and entity_id = '55555555-0000-0000-0000-0000000000b1'),
  0, 'a plain name/phone edit does not get audited'
);

update public.profiles set role = 'staff', org_id = '44444444-4444-4444-4444-444444444490'
  where id = '55555555-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.audit_log where entity = 'profiles' and entity_id = '55555555-0000-0000-0000-0000000000b1'),
  1, 'a role change does get audited'
);

insert into public.appointment_slots (id, service_id, starts_at, capacity, booked)
values ('dddddddd-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1', now() + interval '1 hour', 1, 1);
insert into public.appointments (id, slot_id, service_id, patient_id, status)
values ('eeeeeeee-0000-0000-0000-0000000000b1', 'dddddddd-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000b1', '55555555-0000-0000-0000-0000000000b1', 'booked');
update public.appointments set status = 'cancelled' where id = 'eeeeeeee-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.audit_log where entity = 'appointments' and entity_id = 'eeeeeeee-0000-0000-0000-0000000000b1'),
  1, 'updating an appointment logs an audit row'
);

select * from finish(true);
rollback;
