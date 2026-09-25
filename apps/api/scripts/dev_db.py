"""Throwaway Postgres for local dev/tests, via rootless podman.

Mirrors the REAL landed schema in supabase/migrations for the columns apps/api
actually queries (profiles.id, tokens.patient_id/service_id, the real
`notifications` and `push_tokens` tables), as a compatible subset -- not the
full FK graph to auth.users/organizations/counters, which is the DB team's
own concern to test.
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
    org_id uuid
);

CREATE TABLE IF NOT EXISTS services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS board_services (
    service_id uuid NOT NULL,
    day date NOT NULL,
    waiting_count int NOT NULL DEFAULT 0,
    avg_service_secs int,
    PRIMARY KEY (service_id, day)
);

CREATE TABLE IF NOT EXISTS tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id uuid NOT NULL,
    service_day date NOT NULL DEFAULT current_date,
    number int NOT NULL DEFAULT 1,
    lane_rank smallint NOT NULL DEFAULT 1,
    priority_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL,
    patient_id uuid,
    called_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
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
