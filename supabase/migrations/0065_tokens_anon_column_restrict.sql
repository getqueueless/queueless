-- tokens_read_anon_temporary (0047) is a row-level policy, `using (true)` -- deliberately as
-- wide as anon's pre-existing table grant, so /t/[id] and /pay/[tokenId]'s raw table reads kept
-- working. What it didn't fix: that underlying grant was still column-unrestricted, so anon could
-- read patient_id, walk_in_label (a walk-in's actual typed name), walkin_patient_id and issued_by
-- straight off any token row it can guess or enumerate the id of -- none of which either
-- anon-facing page's own query even asks for (confirmed: apps/web/src/app/t/[id]/data.ts and
-- apps/web/src/app/pay/[tokenId]/data.ts each select a fixed, narrower column list already), but
-- a raw PostgREST call bypassing the app entirely (`?select=walk_in_label,patient_id`) could.
--
-- Column-restrict the grant to the union of what those two pages actually select today --
-- id/service_id/service_day/number/code/lane/lane_rank/priority_at/status/counter_id/created_at/
-- called_at/serving_at/finished_at for /t/[id], plus fee_inr/hold_expires_at/doctor_id for
-- /pay/[tokenId] -- nothing identifying a patient or walk-in.
revoke select on public.tokens from anon;
grant select (
  id, service_id, service_day, number, code, lane, lane_rank, priority_at, status, counter_id,
  created_at, called_at, serving_at, finished_at, fee_inr, hold_expires_at, doctor_id
) on public.tokens to anon;
