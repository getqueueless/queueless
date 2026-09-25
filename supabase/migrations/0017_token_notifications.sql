create table private.token_notifications (
  token_id uuid not null references public.tokens (id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  constraint token_notifications_kind_valid check (kind in ('3_ahead', 'called')),
  primary key (token_id, kind)
);
