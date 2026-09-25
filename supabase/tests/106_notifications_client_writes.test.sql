begin;
select plan(7);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444106', 't-106', 'Notif Writes Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-000000000106', '44444444-4444-4444-4444-444444444106', 'N', 'Notif Desk', true, 500);

insert into auth.users (id, email) values ('55555555-0000-0000-0000-000000000106', 'p106patient@queueless.test');

create temp table tok as select * from private.mint_token(
  '44444444-4444-4444-4444-444444444106', 'bbbbbbbb-0000-0000-0000-000000000106', 'normal',
  '55555555-0000-0000-0000-000000000106', null, null, now(), null
);

-- an already-delivered notification: resetting its pushed_at would make apps/api push it again
insert into public.notifications (id, patient_id, token_id, kind, title, body, pushed_at)
select 'dddddddd-0000-0000-0000-000000000106', '55555555-0000-0000-0000-000000000106', id,
       'called', 'You''re being called', 'Please proceed to Desk 1', now()
from tok;

set local role anon;
select throws_ok(
  $$ insert into public.notifications (patient_id, token_id, kind, title, body)
     values ('55555555-0000-0000-0000-000000000106', (select id from public.tokens where service_id = 'bbbbbbbb-0000-0000-0000-000000000106'),
             'no_show', 'Forged', 'Forged push') $$,
  '42501', null, 'anon cannot insert a notification (apps/api would push it)'
);
select throws_ok(
  $$ update public.notifications set pushed_at = null where id = 'dddddddd-0000-0000-0000-000000000106' $$,
  '42501', null, 'anon cannot reset pushed_at to trigger a re-push'
);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '55555555-0000-0000-0000-000000000106', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ insert into public.notifications (patient_id, token_id, kind, title, body)
     values ('55555555-0000-0000-0000-000000000106', (select id from public.tokens where service_id = 'bbbbbbbb-0000-0000-0000-000000000106'),
             'no_show', 'Forged', 'Forged push') $$,
  '42501', null, 'a signed-in user cannot insert a notification'
);
select throws_ok(
  $$ update public.notifications set pushed_at = null where id = 'dddddddd-0000-0000-0000-000000000106' $$,
  '42501', null, 'a signed-in user cannot reset pushed_at'
);
select throws_ok(
  $$ update public.notifications set body = 'Forged push' where id = 'dddddddd-0000-0000-0000-000000000106' $$,
  '42501', null, 'a signed-in user cannot rewrite a notification body'
);

-- what apps/mobile actually does
update public.notifications set read_at = now() where id = 'dddddddd-0000-0000-0000-000000000106';
select isnt(
  (select read_at from public.notifications where id = 'dddddddd-0000-0000-0000-000000000106'),
  null, 'the app can still mark a notification read'
);
reset role;

select is(
  (select pushed_at is not null from public.notifications where id = 'dddddddd-0000-0000-0000-000000000106'),
  true, 'pushed_at survived every client attempt'
);

select * from finish(true);
rollback;
