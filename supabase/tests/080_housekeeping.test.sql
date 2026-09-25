begin;
select plan(13);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-4444444444a0', 't-080', 'Housekeeping Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, no_show_minutes, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-0000000000d1', '44444444-4444-4444-4444-4444444444a0', 'G', 'General', true, 5, 500);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000d1', 'p080a@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000d2', 'p080b@queueless.test');
insert into auth.users (id, email) values ('55555555-0000-0000-0000-0000000000d3', 'p080c@queueless.test');

-- appointments: one overdue past grace, one due soon (reminder), one far out (no reminder)
insert into public.appointment_slots (id, service_id, starts_at, capacity, booked)
values
  ('dddddddd-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-0000000000d1', now() - interval '20 minutes', 1, 1),
  ('dddddddd-0000-0000-0000-0000000000d2', 'bbbbbbbb-0000-0000-0000-0000000000d1', now() + interval '10 minutes', 1, 1),
  ('dddddddd-0000-0000-0000-0000000000d3', 'bbbbbbbb-0000-0000-0000-0000000000d1', now() + interval '2 hours', 1, 1);

insert into public.appointments (id, slot_id, service_id, patient_id, status, starts_at)
values
  ('eeeeeeee-0000-0000-0000-0000000000d1', 'dddddddd-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-0000000000d1', '55555555-0000-0000-0000-0000000000d1', 'booked', now() - interval '20 minutes'),
  ('eeeeeeee-0000-0000-0000-0000000000d2', 'dddddddd-0000-0000-0000-0000000000d2', 'bbbbbbbb-0000-0000-0000-0000000000d1', '55555555-0000-0000-0000-0000000000d2', 'booked', now() + interval '10 minutes'),
  ('eeeeeeee-0000-0000-0000-0000000000d3', 'dddddddd-0000-0000-0000-0000000000d3', 'bbbbbbbb-0000-0000-0000-0000000000d1', '55555555-0000-0000-0000-0000000000d3', 'booked', now() + interval '2 hours');

-- called tokens: one timed out, one still fresh
create temp table called_stale as select * from private.mint_token(
  '44444444-4444-4444-4444-4444444444a0','bbbbbbbb-0000-0000-0000-0000000000d1','normal','55555555-0000-0000-0000-0000000000d1',null,null,now(),null
);
update public.tokens set status = 'called', called_at = now() - interval '10 minutes' where id = (select id from called_stale);

create temp table called_fresh as select * from private.mint_token(
  '44444444-4444-4444-4444-4444444444a0','bbbbbbbb-0000-0000-0000-0000000000d1','normal','55555555-0000-0000-0000-0000000000d2',null,null,now(),null
);
update public.tokens set status = 'called', called_at = now() - interval '2 minutes' where id = (select id from called_fresh);

-- stale-day tokens (yesterday's service_day) -- inserted directly, since service_day is a
-- protected sort-key column the state-machine trigger blocks on UPDATE (by design)
insert into public.tokens (id, org_id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, patient_id, created_at)
values ('ffffffff-0000-0000-0000-0000000000d1', '44444444-4444-4444-4444-4444444444a0', 'bbbbbbbb-0000-0000-0000-0000000000d1',
        (private.service_day('44444444-4444-4444-4444-4444444444a0', now()) - 1), 101, 'G-101', 'normal', 1, now() - interval '1 day', 'waiting', '55555555-0000-0000-0000-0000000000d3', now() - interval '1 day');
create temp table stale_waiting as select id from public.tokens where id = 'ffffffff-0000-0000-0000-0000000000d1';

insert into public.tokens (id, org_id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, walk_in_label, created_at, called_at)
values ('ffffffff-0000-0000-0000-0000000000d2', '44444444-4444-4444-4444-4444444444a0', 'bbbbbbbb-0000-0000-0000-0000000000d1',
        (private.service_day('44444444-4444-4444-4444-4444444444a0', now()) - 1), 102, 'G-102', 'normal', 1, now() - interval '1 day', 'called', 'SC', now() - interval '1 day', now());
create temp table stale_called as select id from public.tokens where id = 'ffffffff-0000-0000-0000-0000000000d2';

insert into public.tokens (id, org_id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, walk_in_label, created_at, called_at, serving_at)
values ('ffffffff-0000-0000-0000-0000000000d3', '44444444-4444-4444-4444-4444444444a0', 'bbbbbbbb-0000-0000-0000-0000000000d1',
        (private.service_day('44444444-4444-4444-4444-4444444444a0', now()) - 1), 103, 'G-103', 'normal', 1, now() - interval '1 day', 'serving', 'SS', now() - interval '1 day', now(), now());
create temp table stale_serving as select id from public.tokens where id = 'ffffffff-0000-0000-0000-0000000000d3';

select private.housekeeping();

select is(
  (select status from public.appointments where id = 'eeeeeeee-0000-0000-0000-0000000000d1'),
  'no_show'::public.appointment_status, 'a booked appointment 20 minutes past its slot becomes no_show'
);
select is(
  (select count(*)::int from public.notifications where appointment_id = 'eeeeeeee-0000-0000-0000-0000000000d2' and kind = 'appointment_reminder'),
  1, 'a reminder is inserted for an appointment starting within 30 minutes'
);
select is(
  (select count(*)::int from public.notifications where appointment_id = 'eeeeeeee-0000-0000-0000-0000000000d3' and kind = 'appointment_reminder'),
  0, 'no reminder for an appointment that is hours away'
);

select is((select status from public.tokens where id = (select id from called_stale)), 'no_show'::public.token_status, 'a called token past no_show_minutes becomes no_show');
select is((select count(*)::int from public.notifications where token_id = (select id from called_stale) and kind = 'no_show'), 1, 'a no_show notification is inserted');
select is((select status from public.tokens where id = (select id from called_fresh)), 'called'::public.token_status, 'a freshly-called token is left alone');

select is((select status from public.tokens where id = (select id from stale_waiting)), 'cancelled'::public.token_status, 'a stale-day waiting token is cancelled');
select is((select count(*)::int from public.notifications where token_id = (select id from stale_waiting) and kind = 'expired'), 1, 'an expired notification is inserted for the cancelled stale ticket');
select is((select status from public.tokens where id = (select id from stale_called)), 'no_show'::public.token_status, 'a stale-day called token becomes no_show');
select is((select status from public.tokens where id = (select id from stale_serving)), 'done'::public.token_status, 'a stale-day serving token is auto-closed to done');
select is(
  (select count(*)::int from public.audit_log where entity = 'tokens' and entity_id = (select id from stale_serving) and action = 'auto_closed'),
  1, 'the auto-close is recorded in the audit log with its own action'
);

-- idempotency: running housekeeping again does not duplicate the reminder
select private.housekeeping();
select is(
  (select count(*)::int from public.notifications where appointment_id = 'eeeeeeee-0000-0000-0000-0000000000d2' and kind = 'appointment_reminder'),
  1, 'a second consecutive run does not insert a duplicate reminder'
);
select is(
  (select count(*)::int from public.notifications where token_id = (select id from called_stale) and kind = 'no_show'),
  1, 'a second run does not duplicate the no_show notification either'
);

select * from finish(true);
rollback;
