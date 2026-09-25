begin;
select plan(4);

insert into public.organizations (id, slug, name, timezone)
values
  ('11111111-1111-1111-1111-111111111111', 't-020-ist', 'IST org', 'Asia/Kolkata'),
  ('22222222-2222-2222-2222-222222222222', 't-020-utc', 'UTC org', 'UTC');

select is(
  private.service_day('11111111-1111-1111-1111-111111111111', '2026-01-15 19:00:00+00'::timestamptz),
  '2026-01-16'::date,
  'IST org: 19:00 UTC is already past midnight IST (00:30), rolls to the next day'
);

select is(
  private.service_day('11111111-1111-1111-1111-111111111111', '2026-01-15 10:00:00+00'::timestamptz),
  '2026-01-15'::date,
  'IST org: 10:00 UTC is 15:30 IST, same day'
);

select is(
  private.service_day('22222222-2222-2222-2222-222222222222', '2026-01-15 23:30:00+00'::timestamptz),
  '2026-01-15'::date,
  'UTC org: 23:30 UTC is still the same UTC day'
);

select is(
  private.service_day('11111111-1111-1111-1111-111111111111', '2026-01-15 23:30:00+00'::timestamptz),
  '2026-01-16'::date,
  'same instant, IST org rolls to the next day -- proves the org timezone column is actually used'
);

select * from finish(true);
rollback;
