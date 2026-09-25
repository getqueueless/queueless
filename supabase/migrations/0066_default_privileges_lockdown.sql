-- P1 (red-team audit): every "wide open to anon/authenticated by default" hole this whole pass
-- has been closing (profiles, tokens, payments_ledger, ...) traces back to the SAME root cause,
-- confirmed by reading pg_default_acl directly: `postgres` (every migration in this repo, this
-- one included, runs as postgres) has a default ACL that grants anon, authenticated AND
-- service_role full privileges on every future table/sequence/function in public, automatically,
-- the moment it's created. Every table this session locked down had to be found and fixed one at
-- a time because nothing ever revoked this. This migration doesn't touch a single existing
-- object -- it only changes what a FUTURE `create table`/`create function`/`create sequence`
-- (as postgres, i.e. any migration from here on) starts with, closing the hole at its source so
-- the next migration that adds a table doesn't silently reopen it.
--
-- pg_default_acl also has a matching entry for `supabase_admin` (the base image's own bootstrap
-- role, not something any migration in this repo runs as) -- tried and left alone: `postgres` is
-- a powerful role in this self-hosted image but not a real superuser, and altering another
-- role's default privileges needs actually being that role (confirmed empirically: `permission
-- denied to change default privileges`). Since nothing in migrations/*.sql ever creates a public
-- object as supabase_admin, this doesn't leave a gap in what this migration set covers.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- P2 (red-team audit): audit_log's own identity sequence -- USAGE on it lets a role call
-- nextval()/currval() directly, which is meaningless without INSERT on audit_log itself (which
-- neither anon nor authenticated has, and never will -- see 0047), but it's privilege audit_log
-- was never meant to hand out, so it's revoked on principle, matching the rest of this table's
-- lockdown.
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

-- P2 (red-team audit): any signed-in patient could create a brand new organization --
-- organizations_admin_insert (0030) checked nothing about the caller beyond being
-- `authenticated`, since a brand new org has no admin yet to check against. Nothing in this
-- product ever lets a real user self-service a new organization (onboarding a hospital is an
-- operational/support action, not a product feature), so the policy and the grant it needs both
-- go. Reads and an existing admin's own-org update are untouched.
drop policy organizations_admin_insert on public.organizations;
revoke insert on public.organizations from authenticated;
