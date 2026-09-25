begin;
select plan(1);

-- What this actually guards against: a public RPC that lets a caller supply "now" (or a day
-- computed from it) to backdate priority, empty a rate-limit window, or dodge a check-in
-- window -- see supabase/README.md and the p_now rule in 0009/0010's own design notes.
-- Two named, narrow exceptions, both recorded DATA rather than a substitute for now(), and
-- neither does any time-window or rate-limit math with the date it takes:
--   admin_upsert_doctor_leave(from_date, to_date) -- a leave period an admin is entering
--   complete_my_profile(date_of_birth)            -- the patient's own birth date
select is_empty(
  $$
  select p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid not in (
      'public.admin_upsert_doctor_leave(uuid,uuid,date,date,text)'::regprocedure,
      'public.complete_my_profile(text,text,date,public.gender,text,text)'::regprocedure
    )
    and exists (
      select 1 from unnest(p.proargtypes) as at(oid)
      where at.oid in ('timestamptz'::regtype, 'timestamp'::regtype, 'date'::regtype)
    )
  $$,
  'no function in schema public accepts a timestamptz/timestamp/date argument, except the two named, narrow exceptions'
);

select * from finish(true);
rollback;
