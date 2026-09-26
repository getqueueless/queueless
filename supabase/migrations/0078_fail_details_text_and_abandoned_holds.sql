-- Two fixes for the paid-booking limits Yash hit on a real phone (2026-09-26).
--
-- 1. private.fail put p_details into the PGRST message as a JSON *object*. PostgREST only accepts
-- a string there, so every call that passed details (already_active, already_booked) came back
-- to the client as "Could not parse JSON in the RAISE SQLSTATE 'PGRST' error" instead of the real
-- code. Send it as a JSON string; both clients already JSON.parse a string details.
create or replace function private.fail(
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
    message = json_build_object('code', p_code, 'message', p_message, 'details', p_details::text)::text,
    detail = json_build_object(
      'status', p_status,
      'headers', case
        when p_retry_after is null then json_build_object()
        else json_build_object('Retry-After', greatest(p_retry_after, 1)::text)
      end
    )::text;
end;
$$;

-- 2. A payment hold that was cancelled or expired without ever being paid is not a real booking or
-- a real cancellation. It was still counted toward the 3-cancellations cooldown (tokens) and the
-- 3-bookings-a-day cap (appointments), so a couple of stuck payments locked a patient out for the
-- day. The rest of the limit stays as it is: an open hold still blocks a second one until the
-- patient cancels it or it expires after 10 minutes.
--
-- The four functions are long and were redefined across several migrations, so instead of copying
-- each whole body again this patches the one counting clause in the live definition, and fails
-- loudly if the clause is not there.
do $$
declare
  v_fn text;
  v_def text;
  v_new text;
  v_tok_old constant text := $q$and status in ('cancelled', 'no_show');$q$;
  v_tok_new constant text := $q$and status in ('cancelled', 'no_show')
      and not (status = 'cancelled' and hold_expires_at is not null and not exists (
        select 1 from public.payments p where p.token_id = tokens.id and p.captured_at is not null));$q$;
  v_apt_old constant text := $q$and private.service_day(v_service.org_id, a.created_at) = private.service_day(v_service.org_id, now());$q$;
  v_apt_new constant text := $q$and private.service_day(v_service.org_id, a.created_at) = private.service_day(v_service.org_id, now())
      and not (a.status = 'cancelled' and not exists (
        select 1 from public.payments p where p.appointment_id = a.id and p.captured_at is not null));$q$;
begin
  foreach v_fn in array array['public.issue_token', 'public.start_paid_booking', 'public.start_paid_appointment', 'public.book_appointment'] loop
    v_def := pg_get_functiondef(v_fn::regproc);
    if position(v_tok_old in v_def) = 0 then
      raise exception '0078: cooldown clause not found in %', v_fn;
    end if;
    v_new := replace(v_def, v_tok_old, v_tok_new);
    if v_fn in ('public.start_paid_appointment', 'public.book_appointment') then
      if position(v_apt_old in v_def) = 0 then
        raise exception '0078: booking-cap clause not found in %', v_fn;
      end if;
      v_new := replace(v_new, v_apt_old, v_apt_new);
    end if;
    execute v_new;
  end loop;
end;
$$;
