begin;
select plan(8);

select has_column('public', 'profiles', 'language', 'profiles has a language column');
select col_default_is('public', 'profiles', 'language', 'en'::text, 'language defaults to en');
select col_not_null('public', 'profiles', 'language', 'language is not null');

insert into auth.users (id, email) values
  ('11100000-0000-0000-0000-000000000112', 'lang112@queueless.test');

select throws_ok(
  $$ update public.profiles set language = 'fr' where id = '11100000-0000-0000-0000-000000000112' $$,
  '23514', null, 'the check constraint rejects an unsupported language directly'
);

-- no JWT claims set yet -- auth.uid() is null, so this must hit not_signed_in before it ever
-- reaches the language check.
select throws_ok(
  $$ select public.set_my_language('hi') $$,
  'PGRST', null, 'set_my_language refuses an anonymous caller'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11100000-0000-0000-0000-000000000112', 'role', 'authenticated')::text,
  true
);
select throws_ok(
  $$ select public.set_my_language('fr') $$,
  'PGRST', null, 'signed in, set_my_language rejects an unsupported language with a friendly error'
);
select is(
  (public.set_my_language('pa')).language, 'pa', 'set_my_language updates and returns the caller''s own profile'
);
reset role;

select is(
  (select language from public.profiles where id = '11100000-0000-0000-0000-000000000112'),
  'pa', 'the update actually persisted (checked as postgres)'
);

select * from finish(true);
rollback;
