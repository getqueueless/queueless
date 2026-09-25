begin;
select plan(7);

create or replace function pg_temp.call_fail(
  p_status int, p_code text, p_message text, p_retry_after int, p_details jsonb,
  out v_message text, out v_detail text
) as $$
begin
  begin
    perform private.fail(p_status, p_code, p_message, p_retry_after, p_details);
  exception when sqlstate 'PGRST' then
    get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
  end;
end;
$$ language plpgsql;

select is(
  r.v_message::jsonb ->> 'code', 'busy', 'code field is set'
) from pg_temp.call_fail(429, 'busy', 'Still working on your last request', 1, null) r;

select is(
  r.v_message::jsonb ->> 'message', 'Still working on your last request', 'message field is set'
) from pg_temp.call_fail(429, 'busy', 'Still working on your last request', 1, null) r;

select is(
  r.v_detail::jsonb ->> 'status', '429', 'status lands in detail'
) from pg_temp.call_fail(429, 'busy', 'Still working on your last request', 1, null) r;

select is(
  r.v_detail::jsonb -> 'headers' ->> 'Retry-After', '1', 'Retry-After header present as a string'
) from pg_temp.call_fail(429, 'busy', 'Still working on your last request', 1, null) r;

select is(
  r.v_detail::jsonb -> 'headers' ->> 'Retry-After', '1', 'Retry-After floors to 1, never 0 or negative'
) from pg_temp.call_fail(429, 'rate_limited', 'slow down', 0, null) r;

select is(
  r.v_detail::jsonb -> 'headers', '{}'::jsonb, 'headers is an empty object, never null, when no retry_after'
) from pg_temp.call_fail(409, 'illegal_transition', 'nope', null, null) r;

select is(
  r.v_message::jsonb -> 'details' ->> 'token_id', 'abc-123', 'details payload passes through'
) from pg_temp.call_fail(409, 'already_active', 'already have one', null, '{"token_id": "abc-123"}'::jsonb) r;

select * from finish(true);
rollback;
