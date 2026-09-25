"""Throwaway Postgres for local dev/tests, via rootless podman.

Mirrors the DB team's documented (but not-yet-migrated) table names:
profiles, tokens, push_tokens, token_notifications. This schema lives only
in this fixture -- it is never written to supabase/migrations.
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
    user_id uuid PRIMARY KEY,
    role text NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service text NOT NULL,
    status text NOT NULL,
    user_id uuid,
    called_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS push_tokens (
    user_id uuid NOT NULL,
    device_id text NOT NULL,
    token text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_notifications (
    token_id uuid NOT NULL,
    kind text NOT NULL,
    PRIMARY KEY (token_id, kind)
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
