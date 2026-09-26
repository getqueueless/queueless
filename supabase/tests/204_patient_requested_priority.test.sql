-- 0072: patient-requested priority. Senior auto-applies from date_of_birth; pregnant/emergency
-- stay pending until staff verifies; a patient can't spam more than 1 pending request/day;
-- rejecting clears the request; check_in carries an appointment's request onto its token.
begin;
select plan(14);

insert into public.organizations (id, slug, name, timezone)
values ('a0000000-0000-0000-0000-000000000204', 't-204', 'Priority Org', 'Asia/Kolkata');
insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values
  ('b0000000-0000-0000-0000-000000000206', 'a0000000-0000-0000-0000-000000000204', 'A', 'Svc A', true, 500),
  ('b0000000-0000-0000-0000-000000000207', 'a0000000-0000-0000-0000-000000000204', 'B', 'Svc B', true, 500);
insert into public.doctors (id, org_id, service_id, name, specialty, fee_inr, active)
values
  ('d0000000-0000-0000-0000-000000000205', 'a0000000-0000-0000-0000-000000000204', 'b0000000-0000-0000-0000-000000000206', 'Dr. A', 'General', 400, true),
  ('d0000000-0000-0000-0000-000000000206', 'a0000000-0000-0000-0000-000000000204', 'b0000000-0000-0000-0000-000000000207', 'Dr. B', 'General', 400, true);

insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-000000000206', 'p204senior@queueless.test'),
  ('c0000000-0000-0000-0000-000000000207', 'p204pregnant@queueless.test'),
  ('c0000000-0000-0000-0000-000000000208', 'p204staff@queueless.test');
update public.profiles set profile_completed_at = now(), date_of_birth = '1950-01-01'
  where id = 'c0000000-0000-0000-0000-000000000206';
update public.profiles set profile_completed_at = now(), date_of_birth = '1995-01-01'
  where id = 'c0000000-0000-0000-0000-000000000207';
update public.profiles set role = 'staff', org_id = 'a0000000-0000-0000-0000-000000000204'
  where id = 'c0000000-0000-0000-0000-000000000208';

-- senior: auto-applied immediately, no staff step needed
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000206', 'role', 'authenticated')::text, true);
select id as senior_tok from public.start_paid_booking('d0000000-0000-0000-0000-000000000205'::uuid) \gset
reset role;

select is(
  (select lane from public.tokens where id = :'senior_tok'::uuid),
  'senior'::public.lane, 'a senior patient''s lane is elevated immediately, not pending'
);
select is(
  (select requested_lane from public.tokens where id = :'senior_tok'::uuid),
  'senior'::public.lane, 'requested_lane records it too, for the staff ID check'
);

-- pregnant: stays normal until staff verifies
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000207', 'role', 'authenticated')::text, true);
select id as preg_tok from public.start_paid_booking('d0000000-0000-0000-0000-000000000206'::uuid, 'pregnant'::public.lane, 'Due next month') \gset

select is(
  (select lane from public.tokens where id = :'preg_tok'::uuid),
  'normal'::public.lane, 'a pregnant request does NOT change the lane on its own'
);
select is(
  (select requested_lane from public.tokens where id = :'preg_tok'::uuid),
  'pregnant'::public.lane, 'the request itself is recorded, pending'
);
select is(
  (select requested_lane_note from public.tokens where id = :'preg_tok'::uuid),
  'Due next month', 'the note is recorded'
);

-- anti-abuse: a 2nd pending request the same day is refused, even a different service
select throws_ok(
  format($$ select public.start_paid_booking('d0000000-0000-0000-0000-000000000205', 'emergency'::public.lane) $$),
  'PGRST', null, 'a 2nd pending priority request the same day is refused'
);

-- patients can't request the appointment lane
select throws_ok(
  $$ select public.start_paid_appointment('00000000-0000-0000-0000-000000000000', 'appointment'::public.lane) $$,
  'PGRST', null, 'requesting the appointment lane is refused (fails before even reaching the not-found slot check)'
);

-- a note over 80 chars is refused
select throws_ok(
  format($$ select public.start_paid_booking('d0000000-0000-0000-0000-000000000205', 'pregnant'::public.lane, %L) $$,
    repeat('x', 81)),
  'PGRST', null, 'a note over 80 characters is refused'
);
reset role;

-- verify_priority only elevates a WAITING token (a patient at the actual counter) -- simulate
-- payment having gone through, the same way confirm_payment would flip it.
update public.tokens set status = 'waiting' where id = :'preg_tok'::uuid;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000208', 'role', 'authenticated')::text, true);
select public.verify_priority(:'preg_tok'::uuid, 'pregnant'::public.lane);
reset role;
select is(
  (select lane from public.tokens where id = :'preg_tok'::uuid),
  'pregnant'::public.lane, 'staff verifying the request actually elevates the lane'
);

-- resolve preg_tok so the same patient/service isn't "already active" for the next request --
-- waiting -> cancelled is a valid direct transition (the state machine doesn't allow
-- waiting -> done directly, has to go through called/serving)
update public.tokens set status = 'cancelled' where id = :'preg_tok'::uuid;

-- staff can reject a different pending request, clearing it (lane stays wherever it was)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000207', 'role', 'authenticated')::text, true);
select id as preg_tok2 from public.start_paid_booking('d0000000-0000-0000-0000-000000000206'::uuid, 'emergency'::public.lane) \gset
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000208', 'role', 'authenticated')::text, true);
select public.verify_priority(:'preg_tok2'::uuid, 'normal'::public.lane);
reset role;
select is(
  (select requested_lane from public.tokens where id = :'preg_tok2'::uuid) is null,
  true, 'rejecting clears requested_lane'
);
select is(
  (select lane from public.tokens where id = :'preg_tok2'::uuid),
  'normal'::public.lane, 'rejecting never elevated the lane in the first place'
);

-- free the slot for the next assertion (already_active would otherwise block a 3rd request on
-- the same service, unrelated to what this test is actually checking)
update public.tokens set status = 'cancelled' where id = :'preg_tok2'::uuid;

-- and now that it's cleared, a fresh request the same day is allowed again
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000207', 'role', 'authenticated')::text, true);
select id as preg_tok3 from public.start_paid_booking('d0000000-0000-0000-0000-000000000206'::uuid, 'emergency'::public.lane) \gset
reset role;
select is(:'preg_tok3'::uuid is not null, true, 'a rejected request frees up the daily slot for a new one');

-- reject_priority(p_token): the real, named door -- same effect as verify_priority(id,'normal'),
-- what counter-console.tsx's Reject button actually needs (its own raw UPDATE attempt fails,
-- authenticated has no direct write on tokens)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c0000000-0000-0000-0000-000000000208', 'role', 'authenticated')::text, true);
select public.reject_priority(:'preg_tok3'::uuid);
reset role;
select is(
  (select requested_lane from public.tokens where id = :'preg_tok3'::uuid) is null,
  true, 'reject_priority clears the request under its own name'
);
select is(
  has_function_privilege('anon', 'public.reject_priority(uuid)', 'EXECUTE'),
  false, 'anon cannot call reject_priority'
);

select * from finish(true);
rollback;
