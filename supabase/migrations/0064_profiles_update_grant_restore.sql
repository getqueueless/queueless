-- 0063 (the verbatim, hand-run prod hotfix -- see its own header for why it can't be edited)
-- blanket-revokes update on profiles from authenticated, which is correct for the emergency it
-- fixed but also undoes 0045's narrower, already-pushed `update (full_name, phone, language)`
-- grant -- 0063 has to run after payments (0050-0059) and therefore after 0045, so its later
-- revoke wins on a fresh migrate. Restore the one column-scoped grant a signed-in user actually
-- needs (their own profile edit), rather than editing either the historical hotfix record or an
-- already-pushed migration.
grant update (full_name, phone, language) on public.profiles to authenticated;
