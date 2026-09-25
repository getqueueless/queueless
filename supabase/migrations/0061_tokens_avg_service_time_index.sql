-- Load-test pass (EXPLAIN ANALYZE against ~194k synthetic tokens spread across 120 days / 4
-- services): mint_token, call_next, the by-id status read, the display board query and the /my
-- token list are all already index-backed and stay fast regardless of table size (point lookups
-- on tokens_pkey/tokens_patient_rate_limit, or bounded by same-day/same-service row counts via
-- tokens_queue/tokens_service_day_number_unique). One real gap: private.tokens_after_write's
-- (0024) average-service-time sample --
--   select finished_at, serving_at from tokens
--   where service_id = X and status = 'done' and finished_at/serving_at is not null
--     and extract(epoch from (finished_at - serving_at)) between 30 and 1800
--   order by finished_at desc limit 20
-- -- runs on EVERY 'done' write and has no day filter, so it scans a service's entire history,
-- not just today's. Measured before this index: Parallel Seq Scan, ~48k rows filtered per
-- worker, 17.1ms. After: Index Scan, 0.1ms (~150x). Grows worse, unbounded, as more days of
-- history accumulate -- exactly the kind of thing a load test is for.
create index tokens_service_done_finished_idx on public.tokens (service_id, finished_at desc)
  where status = 'done' and finished_at is not null and serving_at is not null;
