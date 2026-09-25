-- private.tokens_after_write (0044) broadcasts a public, minimal payload to two topics on every
-- token insert/update -- postgres_changes never fires (supabase_realtime publication is empty,
-- see 0044's header) so this is the only way an anonymous /t/<id> viewer or the TV board hears
-- about a change. Assert directly against realtime.messages: same technique as 180's assertion
-- that a trigger side effect landed, since realtime.send() swallows its own errors (WARNING, not
-- an exception) and would otherwise fail silently.
begin;
select plan(9);

insert into public.organizations (id, slug, name, timezone)
values ('44444444-4444-4444-4444-444444444490', 't-190', 'Broadcast Org', 'UTC');

insert into public.services (id, org_id, code, name, is_open, default_service_secs, max_tokens_per_day)
values ('bbbbbbbb-0000-0000-0000-0000000000b1', '44444444-4444-4444-4444-444444444490', 'G', 'General', true, 300, 500);

insert into public.counters (id, org_id, name, state)
values ('cccccccc-0000-0000-0000-0000000000b1', '44444444-4444-4444-4444-444444444490', 'Desk 1', 'open');

create temp table walkin as select * from private.mint_token(
  '44444444-4444-4444-4444-444444444490','bbbbbbbb-0000-0000-0000-0000000000b1','normal',null,'W1',null,now(),null
);

select is(
  (select count(*)::int from realtime.messages
     where topic = 'service:bbbbbbbb-0000-0000-0000-0000000000b1' and event = 'token_update' and not private),
  1, 'the walk-in mint broadcasts once to the service topic, publicly'
);
select is(
  (select count(*)::int from realtime.messages
     where topic = 'token:' || (select id from walkin)::text and event = 'token_update' and not private),
  1, 'and once to its own per-token topic, publicly'
);

select is(
  (select payload ->> 'status' from realtime.messages
     where topic = 'token:' || (select id from walkin)::text limit 1),
  'waiting', 'payload carries the current status'
);
select is(
  (select (payload ->> 'number')::int from realtime.messages
     where topic = 'token:' || (select id from walkin)::text limit 1),
  (select number from walkin), 'payload carries the token number'
);
select is(
  (select payload -> 'counter_id' from realtime.messages
     where topic = 'token:' || (select id from walkin)::text limit 1),
  'null'::jsonb, 'not yet at a counter, so counter_id is null'
);
select ok(
  (select payload ->> 'updated_at' from realtime.messages
     where topic = 'token:' || (select id from walkin)::text limit 1) is not null,
  'payload carries an updated_at timestamp'
);

select is(
  (select array(select jsonb_object_keys(payload) from realtime.messages
     where topic = 'token:' || (select id from walkin)::text limit 1) - array['id']),
  array['counter_id', 'number', 'status', 'token_id', 'updated_at'],
  'payload has exactly the 5 documented fields (plus realtime''s own auto-added id) -- no patient name, phone, or user id'
);

update public.tokens set status = 'called', counter_id = 'cccccccc-0000-0000-0000-0000000000b1', called_at = now()
  where id = (select id from walkin);

select is(
  (select payload ->> 'status' from realtime.messages
     where topic = 'token:' || (select id from walkin)::text order by inserted_at desc limit 1),
  'called', 'the update broadcasts again with the new status'
);
select is(
  (select payload ->> 'counter_id' from realtime.messages
     where topic = 'token:' || (select id from walkin)::text order by inserted_at desc limit 1),
  'cccccccc-0000-0000-0000-0000000000b1', 'and the assigned counter_id'
);

select * from finish(true);
rollback;
