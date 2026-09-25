-- apps/api claims a row by setting pushed_at (update ... where pushed_at is null), then sends the push.
alter table public.notifications add column pushed_at timestamptz;

-- Rows from before push delivery existed were never pushed and are stale now. Mark them handled in
-- this same transaction, or apps/api's poller sends the whole backlog within one tick.
update public.notifications set pushed_at = now();

create index notifications_unpushed_idx on public.notifications (created_at)
  where pushed_at is null;

grant select on public.notifications to queueless_api;
grant update (pushed_at) on public.notifications to queueless_api;

-- apps/api's listen_task LISTENs on notifications_events and parses {id, patient_id, body}.
-- body is capped because pg_notify raises on payloads of 8000+ bytes, which would fail the insert
-- and the call_next behind it (the called body embeds the counter name).
create function private.notify_new_notification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_notify(
    'notifications_events',
    json_build_object('id', new.id, 'patient_id', new.patient_id, 'body', left(new.body, 1000))::text
  );
  return new;
end;
$$;

create trigger notifications_notify_new
  after insert on public.notifications
  for each row execute function private.notify_new_notification();

-- apps/api's auth check reads only these columns; full_name and phone stay unreadable.
grant select (id, org_id, role) on public.profiles to queueless_api;
grant select on public.services to queueless_api;

-- 0030 turned RLS on for services and board_services with policies for anon/authenticated only,
-- so a grant alone returns zero rows to queueless_api. push_tokens (RLS since 0016) had a select
-- policy for it but no delete policy, so apps/api's cleanup deleted nothing.
create policy services_api_read on public.services
  for select to queueless_api using (true);

create policy board_services_api_read on public.board_services
  for select to queueless_api using (true);

create policy push_tokens_api_delete on public.push_tokens
  for delete to queueless_api using (true);

alter role queueless_api with password :'queueless_api_db_password';
