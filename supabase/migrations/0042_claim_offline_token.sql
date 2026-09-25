-- Tracks FAILED claim attempts only, for the 5/hour lockout -- a private table, never exposed
-- (not even to the account it belongs to), same reasoning as walkin_patients/cash_receipts.
create table private.claim_attempts (
  id bigint generated always as identity primary key,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index claim_attempts_patient_idx on private.claim_attempts (patient_id, attempted_at);

alter table private.claim_attempts enable row level security;
revoke all on private.claim_attempts from public, anon, authenticated;

-- claim_offline_token cannot use this codebase's usual "RAISE sqlstate 'PGRST' ... " pattern for
-- its failure paths, and that's a deliberate, load-bearing choice, not an oversight -- proven
-- while building this: PostgREST runs one HTTP request as one transaction, and ANY error raised
-- anywhere in it rolls back EVERYTHING in that transaction, with no partial persistence -- see
-- concurrency-postgrest.md's own "In-DB rate limiting cannot log rejected attempts" note, which
-- this migration ran straight into empirically (a first version inserted into
-- private.claim_attempts and then raised; every single row vanished on rollback, so
-- too_many_attempts could never fire -- confirmed with a failing pgTAP run before this rewrite).
-- The only ways to make a write outlive a later error in vanilla Postgres are an autonomous-
-- transaction extension (dblink/pg_background) or a second HTTP round trip; dblink specifically
-- needs a live password in its connection string, and embedding one in a function's source
-- would sit forever in pg_proc.prosrc, readable by anyone who can read that catalog -- a worse
-- hole than the one being closed. So: this function returns a RESULT ROW instead of raising for
-- every claim-specific outcome (a real behavioural difference from every other RPC in this
-- schema), which lets its writes commit on every path, including failure. not_signed_in and
-- profile_incomplete are true preconditions with nothing to count, so those still raise like
-- normal, before any of this matters.
create type public.claim_result as (
  token public.tokens,
  error_code text,
  retry_after int
);

create function public.claim_offline_token(p_token_code text)
returns public.claim_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid := auth.uid();
  v_patient_phone text;
  v_recent_failures int;
  v_candidate public.tokens;
  v_candidate_count int;
  v_token public.tokens;
  v_result public.claim_result;
begin
  if v_patient is null then
    perform private.fail(401, 'not_signed_in', 'Please sign in to continue');
  end if;

  perform private.require_complete_profile(v_patient);

  if not pg_try_advisory_xact_lock(hashtextextended('patient:' || v_patient, 0)) then
    perform private.fail(429, 'busy', 'Still working on your last request', 1);
  end if;

  select count(*) into v_recent_failures
    from private.claim_attempts
    where patient_id = v_patient and attempted_at > now() - interval '1 hour';
  if v_recent_failures >= 5 then
    v_result.error_code := 'too_many_attempts';
    v_result.retry_after := 3600;
    return v_result;
  end if;

  select phone into v_patient_phone from public.profiles where id = v_patient;

  -- Exactly one eligible, unclaimed, today's ticket with this code and a matching walk-in
  -- phone. More than one match (a code collision across services/orgs) is treated the same as
  -- zero: not safe to guess, so it fails the same generic way.
  select count(*) into v_candidate_count
    from public.tokens t
    join public.walkin_patients w on w.id = t.walkin_patient_id
    where t.code = p_token_code
      and t.patient_id is null
      and t.status in ('waiting', 'called')
      and t.service_day = private.service_day(t.org_id, now())
      and w.phone = v_patient_phone;

  if v_candidate_count = 1 then
    select t.* into v_candidate
      from public.tokens t
      join public.walkin_patients w on w.id = t.walkin_patient_id
      where t.code = p_token_code
        and t.patient_id is null
        and t.status in ('waiting', 'called')
        and t.service_day = private.service_day(t.org_id, now())
        and w.phone = v_patient_phone;
  end if;

  if v_candidate_count = 1 and exists (
    select 1 from public.tokens where patient_id = v_patient and service_id = v_candidate.service_id
      and status in ('waiting', 'called', 'serving')
  ) then
    -- The caller's OWN state -- safe to name specifically, it's their own account, and this
    -- still counts toward the failure lockout like every other rejected attempt.
    insert into private.claim_attempts (patient_id) values (v_patient);
    insert into public.audit_log (org_id, entity, entity_id, action, new)
    values (v_candidate.org_id, 'tokens', v_candidate.id, 'claim_offline_token_failed',
      json_build_object('code_attempted', p_token_code, 'reason', 'caller_already_active')::jsonb);
    v_result.error_code := 'already_active';
    return v_result;
  end if;

  if v_candidate_count <> 1 then
    insert into private.claim_attempts (patient_id) values (v_patient);
    insert into public.audit_log (org_id, entity, entity_id, action, new)
    values (null, 'tokens', null, 'claim_offline_token_failed',
      json_build_object('code_attempted', p_token_code, 'reason',
        case when v_candidate_count = 0 then 'no_match' else 'ambiguous_match' end)::jsonb);
    v_result.error_code := 'claim_failed';
    return v_result;
  end if;

  update public.tokens set patient_id = v_patient where id = v_candidate.id
    returning * into v_token;

  insert into public.audit_log (org_id, entity, entity_id, action, new)
  values (v_token.org_id, 'tokens', v_token.id, 'claim_offline_token_succeeded',
    json_build_object('code', p_token_code)::jsonb);

  v_result.token := v_token;
  return v_result;
end;
$$;

revoke execute on function public.claim_offline_token(text) from public, anon;
grant execute on function public.claim_offline_token(text) to authenticated;
