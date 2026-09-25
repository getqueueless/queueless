create function private.tokens_state_machine()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.service_id is distinct from old.service_id
     or new.service_day is distinct from old.service_day
     or new.number is distinct from old.number
     or new.lane_rank is distinct from old.lane_rank then
    perform private.fail(409, 'illegal_transition', 'Sort-key columns cannot change');
  end if;

  if new.priority_at is distinct from old.priority_at and new.priority_at > old.priority_at then
    perform private.fail(409, 'illegal_transition', 'priority_at can only move earlier');
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'waiting' and new.status in ('called', 'cancelled'))
      or (old.status = 'called' and new.status in ('serving', 'skipped', 'no_show'))
      or (old.status = 'serving' and new.status = 'done')
      or (old.status in ('no_show', 'skipped') and new.status = 'called' and old.recall_count < 2)
    ) then
      perform private.fail(409, 'illegal_transition', 'That ticket cannot change state right now');
    end if;
  end if;

  return new;
end;
$$;

create trigger tokens_state_machine
  before update on public.tokens
  for each row execute function private.tokens_state_machine();
