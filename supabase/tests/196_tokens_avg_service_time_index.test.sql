-- 0061: the load-test index exists with the right shape (partial, service_id + finished_at desc,
-- scoped to done/non-null rows only -- matching exactly the WHERE clause of the query in
-- private.tokens_after_write it exists to speed up).
begin;
select plan(1);

select is(
  (select indexdef from pg_indexes where indexname = 'tokens_service_done_finished_idx'),
  'CREATE INDEX tokens_service_done_finished_idx ON public.tokens USING btree (service_id, finished_at DESC) WHERE ((status = ''done''::token_status) AND (finished_at IS NOT NULL) AND (serving_at IS NOT NULL))',
  'the average-service-time index exists with the expected columns and partial predicate'
);

select * from finish(true);
rollback;
