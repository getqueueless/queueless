-- 0065: anon's tokens grant is column-restricted -- can read what /t/[id] and /pay/[tokenId]
-- actually need, never patient_id/walk_in_label/walkin_patient_id/issued_by (a walk-in's real
-- name lives in walk_in_label, so this is a real PII leak closed, not a theoretical one).
begin;
select plan(6);

select is(
  has_column_privilege('anon', 'public.tokens', 'patient_id', 'SELECT'),
  false, 'anon cannot read patient_id'
);
select is(
  has_column_privilege('anon', 'public.tokens', 'walk_in_label', 'SELECT'),
  false, 'anon cannot read walk_in_label -- a walk-in''s actual name'
);
select is(
  has_column_privilege('anon', 'public.tokens', 'walkin_patient_id', 'SELECT'),
  false, 'anon cannot read walkin_patient_id'
);
select is(
  has_column_privilege('anon', 'public.tokens', 'issued_by', 'SELECT'),
  false, 'anon cannot read issued_by'
);
select is(
  has_column_privilege('anon', 'public.tokens', 'status', 'SELECT')
    and has_column_privilege('anon', 'public.tokens', 'counter_id', 'SELECT')
    and has_column_privilege('anon', 'public.tokens', 'called_at', 'SELECT'),
  true, '/t/[id]''s own columns still readable'
);
select is(
  has_column_privilege('anon', 'public.tokens', 'fee_inr', 'SELECT')
    and has_column_privilege('anon', 'public.tokens', 'hold_expires_at', 'SELECT')
    and has_column_privilege('anon', 'public.tokens', 'doctor_id', 'SELECT'),
  true, '/pay/[tokenId]''s own columns still readable'
);

select * from finish(true);
rollback;
