-- apps/api pushes every notifications row to the patient's phone (0031), so clients can't be allowed to
-- write them: rows only ever come from security-definer DB code, and the app only marks one read.
-- Reads stay as they are until notifications gets RLS.
revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
