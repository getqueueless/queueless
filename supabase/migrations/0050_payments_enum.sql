-- Isolated on purpose: ALTER TYPE ... ADD VALUE cannot be used by anything else in the SAME
-- transaction it runs in (migrate.sh applies one file = one transaction, via `psql -1`). Every
-- later migration that references 'pending_payment' (0051+) runs as its own, later transaction,
-- so the value is safely committed and usable there.
alter type public.token_status add value 'pending_payment';
