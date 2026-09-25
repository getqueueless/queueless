-- P2 (red-team audit), 0066: nobody self-services a new organization, and audit_log's identity
-- sequence carries no privilege anon/authenticated were ever meant to have.
begin;
select plan(3);

select is(
  has_table_privilege('authenticated', 'public.organizations', 'INSERT'),
  false, 'authenticated cannot insert organizations any more'
);
select is_empty(
  $$ select 1 from pg_policies where tablename = 'organizations' and policyname = 'organizations_admin_insert' $$,
  'organizations_admin_insert is gone'
);
select is(
  has_sequence_privilege('anon', 'public.audit_log_id_seq', 'USAGE')
    or has_sequence_privilege('authenticated', 'public.audit_log_id_seq', 'USAGE'),
  false, 'neither anon nor authenticated has any privilege on audit_log_id_seq'
);

select * from finish(true);
rollback;
