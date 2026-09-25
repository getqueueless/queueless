alter table public.organizations enable row level security;
revoke all on public.organizations from public, anon, authenticated;
grant select on public.organizations to anon, authenticated;
grant insert, update on public.organizations to authenticated;

create policy organizations_read on public.organizations
  for select to anon, authenticated using (true);
create policy organizations_admin_insert on public.organizations
  for insert to authenticated with check (private.my_role() = 'admin');
create policy organizations_admin_update on public.organizations
  for update to authenticated
  using (id = private.my_org() and private.my_role() = 'admin')
  with check (id = private.my_org() and private.my_role() = 'admin');

alter table public.services enable row level security;
revoke all on public.services from public, anon, authenticated;
grant select on public.services to anon, authenticated;
grant insert, update on public.services to authenticated;

create policy services_read on public.services
  for select to anon, authenticated using (true);
create policy services_admin_insert on public.services
  for insert to authenticated with check (org_id = private.my_org() and private.my_role() = 'admin');
create policy services_admin_update on public.services
  for update to authenticated
  using (org_id = private.my_org() and private.my_role() = 'admin')
  with check (org_id = private.my_org() and private.my_role() = 'admin');

alter table public.counters enable row level security;
revoke all on public.counters from public, anon, authenticated;
grant select on public.counters to anon, authenticated;
grant insert, update on public.counters to authenticated;

create policy counters_read on public.counters
  for select to anon, authenticated using (true);
create policy counters_admin_insert on public.counters
  for insert to authenticated with check (org_id = private.my_org() and private.my_role() = 'admin');
create policy counters_admin_update on public.counters
  for update to authenticated
  using (org_id = private.my_org() and private.my_role() = 'admin')
  with check (org_id = private.my_org() and private.my_role() = 'admin');

alter table public.board_services enable row level security;
revoke all on public.board_services from public, anon, authenticated;
grant select on public.board_services to anon, authenticated;
grant insert, update on public.board_services to authenticated;

create policy board_services_read on public.board_services
  for select to anon, authenticated using (true);
create policy board_services_admin_insert on public.board_services
  for insert to authenticated with check (org_id = private.my_org() and private.my_role() = 'admin');
create policy board_services_admin_update on public.board_services
  for update to authenticated
  using (org_id = private.my_org() and private.my_role() = 'admin')
  with check (org_id = private.my_org() and private.my_role() = 'admin');

alter table public.board_counters enable row level security;
revoke all on public.board_counters from public, anon, authenticated;
grant select on public.board_counters to anon, authenticated;
grant insert, update on public.board_counters to authenticated;

create policy board_counters_read on public.board_counters
  for select to anon, authenticated using (true);
create policy board_counters_admin_insert on public.board_counters
  for insert to authenticated with check (org_id = private.my_org() and private.my_role() = 'admin');
create policy board_counters_admin_update on public.board_counters
  for update to authenticated
  using (org_id = private.my_org() and private.my_role() = 'admin')
  with check (org_id = private.my_org() and private.my_role() = 'admin');
