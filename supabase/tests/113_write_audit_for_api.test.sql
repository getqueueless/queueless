begin;
select plan(6);

insert into public.organizations (id, slug, name, timezone) values
  ('a0000000-0000-0000-0000-000000000113', 't-113', 'Org 113', 'Asia/Kolkata');

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p
     where p.oid = 'private.write_audit(uuid, text, uuid, text, jsonb, jsonb)'::regprocedure
       and has_function_privilege('authenticated', p.oid, 'EXECUTE') $$,
  'authenticated cannot call private.write_audit -- this door is queueless_api-only'
);
select is(
  has_function_privilege('anon', 'private.write_audit(uuid, text, uuid, text, jsonb, jsonb)', 'EXECUTE'),
  false, 'anon cannot call private.write_audit either'
);

grant queueless_api to postgres with set true;
grant usage on schema extensions to queueless_api;
set local role queueless_api;
select lives_ok(
  $$ select private.write_audit(
       'a0000000-0000-0000-0000-000000000113', 'ops_summaries', null, 'push_delivered',
       null, json_build_object('notification_id', 'x')::jsonb
     ) $$,
  'queueless_api can write an audit row through the function'
);
select throws_ok(
  $$ select 1 from public.audit_log $$,
  '42501', null, 'queueless_api still cannot read audit_log directly -- write-only, through the function'
);
select throws_ok(
  $$ insert into public.audit_log (org_id, entity, entity_id, action)
     values ('a0000000-0000-0000-0000-000000000113', 'x', null, 'y') $$,
  '42501', null, 'queueless_api has no raw insert grant on audit_log -- the function is the only door'
);
reset role;

select is(
  (select action from public.audit_log
     where org_id = 'a0000000-0000-0000-0000-000000000113' and entity = 'ops_summaries'
       and actor is null),
  'push_delivered', 'the row queueless_api wrote is actually there, with actor left null'
);

select * from finish(true);
rollback;
