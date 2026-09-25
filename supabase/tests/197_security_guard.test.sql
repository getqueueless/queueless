-- QA #1 item 6: a standing regression guard, not a one-time check. This is exactly the class of
-- bug the rest of this batch was written to fix -- a table or view lands with RLS off, or a
-- stray grant survives -- so it belongs in the suite permanently, run on every db:test, not just
-- asserted once by hand. Pure catalog introspection: no fixtures, nothing to roll back that
-- matters.
begin;
select plan(4);

select is_empty(
  $$ select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every table in the public schema has row level security turned on'
);

select is_empty(
  $$ select grantee || ':' || table_name || ':' || privilege_type
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')
       and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES') $$,
  'anon and authenticated have no TRUNCATE, TRIGGER or REFERENCES grant anywhere in public'
);

select is_empty(
  $$ select c.relname from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and coalesce(c.reloptions, '{}') <> array['security_invoker=on'] $$,
  'every view in the public schema is security_invoker'
);

-- 0066: postgres's default ACL for public (every migration in this repo runs as postgres, so
-- this is what a brand new table/sequence/function starts with) must never mention anon or
-- authenticated -- that's the root cause behind nearly every table this whole pass had to find
-- and fix one at a time.
select is_empty(
  $$ select da.defaclobjtype from pg_default_acl da
     join pg_roles r on r.oid = da.defaclrole
     where r.rolname = 'postgres' and da.defaclnamespace = 'public'::regnamespace
       and exists (
         select 1 from unnest(da.defaclacl) a
         where a::text like 'anon=%' or a::text like 'authenticated=%'
       ) $$,
  'postgres''s default privileges in public grant nothing to anon or authenticated for future tables, sequences or functions'
);

select * from finish(true);
rollback;
