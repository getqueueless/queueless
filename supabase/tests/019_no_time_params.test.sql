begin;
select plan(1);

select is_empty(
  $$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and exists (
      select 1 from unnest(p.proargtypes) as at(oid)
      where at.oid in ('timestamptz'::regtype, 'timestamp'::regtype, 'date'::regtype)
    )
  $$,
  'no function in schema public accepts a timestamptz/timestamp/date argument'
);

select * from finish(true);
rollback;
