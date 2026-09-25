create function private.fail(
  p_status int,
  p_code text,
  p_message text,
  p_retry_after int default null,
  p_details jsonb default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise sqlstate 'PGRST' using
    message = json_build_object('code', p_code, 'message', p_message, 'details', p_details)::text,
    detail = json_build_object(
      'status', p_status,
      'headers', case
        when p_retry_after is null then json_build_object()
        else json_build_object('Retry-After', greatest(p_retry_after, 1)::text)
      end
    )::text;
end;
$$;
