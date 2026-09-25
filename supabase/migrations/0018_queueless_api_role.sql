\set api_pass `echo "$QUEUELESS_API_PASSWORD"`

create role queueless_api with login password :'api_pass';

grant usage on schema public to queueless_api;
grant usage on schema private to queueless_api;

grant select on public.tokens to queueless_api;
grant select on public.board_services to queueless_api;
grant select, delete on public.push_tokens to queueless_api;
grant select, insert on private.token_notifications to queueless_api;

create policy push_tokens_api_read on public.push_tokens
  for select to queueless_api
  using (true);
