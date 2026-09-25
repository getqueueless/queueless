"""Throwaway Postgres for local dev/tests, via rootless podman.

Mirrors the REAL landed schema in supabase/migrations for the columns apps/api
actually queries (profiles.id/org_id, tokens.patient_id/service_id/org_id/
counter_id/serving_at/finished_at, board_services.org_id, audit_log, the
real `notifications` and `push_tokens` tables), as a compatible subset --
not the full FK graph to auth.users/organizations/counters/services, which
is the DB team's own concern to test. No `organizations` or `counters`
tables here on purpose: apps/api's real DB role (queueless_api) has no
grant on either (supabase/migrations/0018), so nothing in this codebase
joins to them for names -- see app/routes/staff.py's comment on returning
raw counter_id/service_id instead.
"""

import asyncio
import subprocess
import time

import asyncpg

CONTAINER_NAME = "queueless-api-test-pg"
HOST_PORT = 55432
DATABASE_URL = f"postgresql://postgres:postgres@localhost:{HOST_PORT}/postgres"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS profiles (
    id uuid PRIMARY KEY,
    role text NOT NULL,
    org_id uuid,
    -- Doesn't exist in the real schema yet (see docs/DECISIONS.md) --
    -- fixture-only so app/notifications.py's translation lookup is
    -- genuinely exercised; prod degrades via UndefinedColumnError until
    -- the DB agent adds it.
    language text
);

CREATE TABLE IF NOT EXISTS services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS board_services (
    service_id uuid NOT NULL,
    day date NOT NULL,
    org_id uuid,
    waiting_count int NOT NULL DEFAULT 0,
    avg_service_secs int,
    PRIMARY KEY (service_id, day)
);

CREATE TABLE IF NOT EXISTS tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid,
    service_id uuid NOT NULL,
    service_day date NOT NULL DEFAULT current_date,
    number int NOT NULL DEFAULT 1,
    lane_rank smallint NOT NULL DEFAULT 1,
    priority_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL,
    patient_id uuid,
    counter_id uuid,
    -- doctor_id/fee_inr/hold_expires_at: real columns from
    -- supabase/migrations/0039 and 0050/0051 (online prepaid bookings) --
    -- app/payments/routes.py reads fee_inr/hold_expires_at directly.
    doctor_id uuid,
    fee_inr int,
    hold_expires_at timestamptz,
    called_at timestamptz,
    serving_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only in the real schema (trigger-enforced there); this fixture
-- doesn't need the trigger since nothing here tests append-only-ness, only
-- that /admin/retrain's audit insert has somewhere real to land.
CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid,
    actor uuid,
    entity text NOT NULL,
    entity_id uuid,
    action text NOT NULL,
    old jsonb,
    new jsonb,
    at timestamptz NOT NULL DEFAULT now()
);

-- FAKE fixture implementations, not the DB team's real analytics.* schema
-- (which doesn't exist on origin/main yet -- see docs/DECISIONS.md). Real
-- enough (real GROUP BY over the real tokens shape) that apps/api's calling
-- code (app/analytics.py) is genuinely exercised against real Postgres, not
-- mocked. Only DeepSeek itself is mocked in pytest.
-- Real function landed: supabase/migrations/0036_write_audit_for_api.sql --
-- queueless_api has EXECUTE on this, never a direct INSERT grant on
-- audit_log itself (stays fully locked down). Fixture mirrors that shape
-- exactly so app/routes/admin.py::retrain_once is tested against the real
-- calling convention, not a raw INSERT it can no longer use.
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.write_audit(
    p_org uuid, p_entity text, p_entity_id uuid, p_action text,
    p_old jsonb DEFAULT NULL, p_new jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO audit_log (org_id, entity, entity_id, action, old, new)
    VALUES (p_org, p_entity, p_entity_id, p_action, p_old, p_new);
END;
$$;

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE OR REPLACE FUNCTION analytics.no_shows_by_service(p_org_id uuid, p_day date)
RETURNS TABLE(service_id uuid, no_show_count bigint, total_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT service_id, count(*) FILTER (WHERE status = 'no_show'), count(*)
  FROM tokens WHERE org_id = p_org_id AND service_day = p_day
  GROUP BY service_id;
$$;

CREATE OR REPLACE FUNCTION analytics.avg_wait_by_hour(p_org_id uuid, p_day date)
RETURNS TABLE(hour int, avg_wait_minutes numeric)
LANGUAGE sql STABLE AS $$
  SELECT extract(hour from created_at)::int, avg(extract(epoch from (called_at - created_at)) / 60)
  FROM tokens WHERE org_id = p_org_id AND service_day = p_day AND called_at IS NOT NULL
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION analytics.busiest_counters(p_org_id uuid, p_day date)
RETURNS TABLE(counter_id uuid, served_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT counter_id, count(*) FROM tokens
  WHERE org_id = p_org_id AND service_day = p_day AND status = 'done' AND counter_id IS NOT NULL
  GROUP BY counter_id;
$$;

CREATE OR REPLACE FUNCTION analytics.tokens_per_day(p_org_id uuid, p_start_day date, p_end_day date)
RETURNS TABLE(day date, token_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT service_day, count(*) FROM tokens
  WHERE org_id = p_org_id AND service_day BETWEEN p_start_day AND p_end_day
  GROUP BY service_day ORDER BY service_day;
$$;

CREATE OR REPLACE FUNCTION analytics.service_time_trend(p_org_id uuid, p_service_id uuid, p_days int)
RETURNS TABLE(day date, avg_service_minutes numeric)
LANGUAGE sql STABLE AS $$
  SELECT service_day, avg(extract(epoch from (finished_at - serving_at)) / 60)
  FROM tokens
  WHERE org_id = p_org_id AND service_id = p_service_id AND status = 'done'
    AND finished_at IS NOT NULL AND serving_at IS NOT NULL
    AND service_day >= current_date - p_days
  GROUP BY service_day ORDER BY service_day;
$$;

-- "vs predicted" is DB-side actual-wait only in this fixture -- the
-- predicted half needs either a stored prediction log or an app-side join
-- against /predict, neither of which exists yet. Flagged in DECISIONS.md.
CREATE OR REPLACE FUNCTION analytics.wait_vs_predicted(p_org_id uuid, p_day date)
RETURNS TABLE(token_id uuid, actual_wait_minutes numeric)
LANGUAGE sql STABLE AS $$
  SELECT id, extract(epoch from (called_at - created_at)) / 60
  FROM tokens WHERE org_id = p_org_id AND service_day = p_day AND called_at IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION analytics.peak_hours(p_org_id uuid, p_day date)
RETURNS TABLE(hour int, token_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT extract(hour from created_at)::int, count(*)
  FROM tokens WHERE org_id = p_org_id AND service_day = p_day
  GROUP BY 1 ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION analytics.lane_mix(p_org_id uuid, p_day date)
RETURNS TABLE(lane_rank smallint, token_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT lane_rank, count(*) FROM tokens
  WHERE org_id = p_org_id AND service_day = p_day
  GROUP BY lane_rank ORDER BY lane_rank;
$$;

-- Real function: supabase/migrations/0040_doctor_wait_estimate.sql --
-- already landed and already granted to queueless_api, unlike the other 8
-- (which this session's own analytics.py contract shaped 0033 to match).
CREATE OR REPLACE FUNCTION analytics.doctor_service_time(p_org_id uuid, p_doctor_id uuid, p_days int)
RETURNS TABLE(avg_service_minutes numeric, sample_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT avg(extract(epoch from (finished_at - serving_at)) / 60), count(*)
  FROM tokens
  WHERE org_id = p_org_id AND doctor_id = p_doctor_id AND status = 'done'
    AND finished_at IS NOT NULL AND serving_at IS NOT NULL
    AND service_day >= current_date - p_days;
$$;

-- Doesn't exist in supabase/migrations yet -- see docs/DECISIONS.md for the
-- CREATE TABLE + grant the DB agent needs to add.
CREATE TABLE IF NOT EXISTS ops_summaries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL,
    day date NOT NULL,
    report text NOT NULL,
    ai_generated boolean NOT NULL DEFAULT true,
    aggregates jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, day)
);

CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL,
    token_id uuid REFERENCES tokens (id),
    appointment_id uuid,
    kind text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    pushed_at timestamptz,
    UNIQUE (token_id, kind)
);

CREATE TABLE IF NOT EXISTS push_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    expo_token text NOT NULL UNIQUE,
    platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Real schema: supabase/migrations/0050-0052 (online prepaid bookings). Real
-- SQL, not mocked, mirroring record_order/confirm_payment/mark_payment_failed/
-- record_refund/doctor_leave_refund_candidates exactly (idempotency, the
-- amount check, NULL-on-rejection) so app/payments/routes.py is genuinely
-- exercised against real Postgres. Only Razorpay's own HTTP API is mocked.
CREATE TABLE IF NOT EXISTS doctor_leaves (
    doctor_id uuid NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid,
    token_id uuid NOT NULL,
    razorpay_order_id text NOT NULL UNIQUE,
    razorpay_payment_id text,
    razorpay_refund_id text,
    amount_inr int NOT NULL,
    status text NOT NULL DEFAULT 'created',
    failure_reason text,
    refund_reason text,
    captured_at timestamptz,
    refunded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.razorpay_webhook_events (
    event_id text PRIMARY KEY,
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION record_order(p_token uuid, p_razorpay_order_id text, p_amount_inr int)
RETURNS payments LANGUAGE plpgsql AS $$
DECLARE
  v_token RECORD;
  v_payment payments;
BEGIN
  SELECT * INTO v_token FROM tokens WHERE id = p_token;
  IF v_token.id IS NULL OR v_token.status <> 'pending_payment' THEN
    RETURN NULL;
  END IF;
  IF v_token.fee_inr IS DISTINCT FROM p_amount_inr THEN
    RETURN NULL;
  END IF;

  INSERT INTO payments (org_id, token_id, razorpay_order_id, amount_inr, status)
  VALUES (v_token.org_id, p_token, p_razorpay_order_id, p_amount_inr, 'created')
  RETURNING * INTO v_payment;
  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION confirm_payment(p_razorpay_order_id text, p_razorpay_payment_id text, p_amount_inr int)
RETURNS payments LANGUAGE plpgsql AS $$
DECLARE
  v_payment payments;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE razorpay_order_id = p_razorpay_order_id FOR UPDATE;
  IF v_payment.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_payment.status = 'captured' THEN
    IF v_payment.razorpay_payment_id IS DISTINCT FROM p_razorpay_payment_id THEN
      RETURN NULL;
    END IF;
    RETURN v_payment;
  END IF;

  IF v_payment.status <> 'created' THEN
    RETURN NULL;
  END IF;
  IF v_payment.amount_inr IS DISTINCT FROM p_amount_inr THEN
    RETURN NULL;
  END IF;

  UPDATE payments SET status = 'captured', razorpay_payment_id = p_razorpay_payment_id, captured_at = now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;
  UPDATE tokens SET status = 'waiting' WHERE id = v_payment.token_id AND status = 'pending_payment';
  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION mark_payment_failed(p_razorpay_order_id text, p_reason text DEFAULT NULL)
RETURNS payments LANGUAGE plpgsql AS $$
DECLARE
  v_payment payments;
BEGIN
  UPDATE payments SET status = 'failed', failure_reason = p_reason
    WHERE razorpay_order_id = p_razorpay_order_id AND status = 'created'
    RETURNING * INTO v_payment;
  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION record_refund(
    p_payment_id uuid, p_razorpay_refund_id text, p_reason text, p_initiated_by uuid DEFAULT NULL
)
RETURNS payments LANGUAGE plpgsql AS $$
DECLARE
  v_payment payments;
BEGIN
  UPDATE payments SET status = 'refunded', razorpay_refund_id = p_razorpay_refund_id,
    refund_reason = p_reason, refunded_at = now()
    WHERE id = p_payment_id AND status = 'captured'
    RETURNING * INTO v_payment;
  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION doctor_leave_refund_candidates()
RETURNS TABLE(payment_id uuid, token_id uuid, doctor_id uuid, org_id uuid, razorpay_payment_id text, amount_inr int)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.token_id, t.doctor_id, p.org_id, p.razorpay_payment_id, p.amount_inr
  FROM payments p
  JOIN tokens t ON t.id = p.token_id
  WHERE p.status = 'captured'
    AND EXISTS (
      SELECT 1 FROM doctor_leaves dl
      WHERE dl.doctor_id = t.doctor_id AND current_date BETWEEN dl.from_date AND dl.to_date
    );
$$;
"""


def start_container() -> None:
    subprocess.run(["podman", "rm", "-f", CONTAINER_NAME], capture_output=True)
    subprocess.run(
        [
            "podman", "run", "--rm", "-d",
            "--name", CONTAINER_NAME,
            "-p", f"{HOST_PORT}:5432",
            "-e", "POSTGRES_PASSWORD=postgres",
            # Same image the DB team's self-hosted Supabase stack runs, already
            # pulled locally by that build -- faithful fixture, no network pull.
            "docker.io/supabase/postgres:17.6.1.136",
        ],
        check=True,
        capture_output=True,
    )


def stop_container() -> None:
    subprocess.run(["podman", "rm", "-f", CONTAINER_NAME], capture_output=True)


async def wait_ready(timeout_seconds: float = 20.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            conn = await asyncpg.connect(DATABASE_URL)
            await conn.close()
            return
        except Exception as exc:  # noqa: BLE001 - retrying until the port is up
            last_error = exc
            await asyncio.sleep(0.5)
    raise RuntimeError(f"postgres never became ready: {last_error}")


async def apply_schema() -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(SCHEMA_SQL)
    finally:
        await conn.close()


async def _main() -> None:
    start_container()
    await wait_ready()
    await apply_schema()
    print(f"DATABASE_URL={DATABASE_URL}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(_main())
