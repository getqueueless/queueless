-- Isolated on purpose, same reason as 0050: ALTER TYPE ... ADD VALUE cannot be used by anything
-- else in the SAME transaction it runs in (migrate.sh applies one file = one transaction).
alter type public.appointment_status add value 'pending_payment';
