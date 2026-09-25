-- Replaces /t/[id]'s raw `.from("tokens").select(TOKEN_COLUMNS).eq("id", id)` (apps/web's own
-- data.ts) with a SECURITY DEFINER RPC anon can call directly, so the tokens_read_anon_temporary
-- policy (0047) can eventually be dropped. Same field set TOKEN_COLUMNS already selected --
-- nothing there was ever PII (patient_id/walkin_patient_id/walk_in_label/issued_by aren't in it)
-- -- plus people_ahead, replacing the client's own countTokensAhead() query (data.ts), computed
-- with the exact same ordering countTokensAhead used: lane_rank, then priority_at, then number.
create function public.get_token_status(p_id uuid)
returns table (
  id uuid, number int, code text, lane public.lane, lane_rank smallint, priority_at timestamptz,
  status public.token_status, counter_id uuid, service_id uuid, service_day date,
  created_at timestamptz, called_at timestamptz, serving_at timestamptz, finished_at timestamptz,
  people_ahead int
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_token public.tokens;
begin
  -- `t.id`, not bare `id`: every RETURNS TABLE column is also an implicit plpgsql variable in
  -- this function's scope, so an unqualified `id` here is ambiguous between that variable and
  -- the tokens.id column (confirmed by actually hitting this error against the RPC, not a
  -- hypothetical -- plpgsql's error is exactly that: "column reference \"id\" is ambiguous").
  select * into v_token from public.tokens t where t.id = p_id;
  if v_token.id is null then
    perform private.fail(404, 'not_found', 'We could not find that ticket');
  end if;

  return query
    select
      v_token.id, v_token.number, v_token.code, v_token.lane, v_token.lane_rank, v_token.priority_at,
      v_token.status, v_token.counter_id, v_token.service_id, v_token.service_day,
      v_token.created_at, v_token.called_at, v_token.serving_at, v_token.finished_at,
      (
        select count(*)::int from public.tokens t2
        where t2.service_id = v_token.service_id and t2.service_day = v_token.service_day
          and t2.status = 'waiting'
          and (
            t2.lane_rank < v_token.lane_rank
            or (t2.lane_rank = v_token.lane_rank and t2.priority_at < v_token.priority_at)
            or (t2.lane_rank = v_token.lane_rank and t2.priority_at = v_token.priority_at and t2.number < v_token.number)
          )
      );
end;
$$;

revoke execute on function public.get_token_status(uuid) from public;
grant execute on function public.get_token_status(uuid) to anon, authenticated;
