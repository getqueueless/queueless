from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="forbid")

    supabase_jwt_secret: str
    database_url: str
    database_url_direct: str
    cors_allow_origins: list[str] = ["http://localhost:3000", "http://localhost:8081"]
    environment: Literal["development", "production"] = "development"

    role_cache_ttl_seconds: float = 5.0
    poll_interval_seconds: int = 5

    # pg_advisory_xact_lock keys share ONE global keyspace across the whole
    # Postgres instance -- the old scheduler.py used 918_273_645 before it
    # was deleted in the delivery-only refactor; this is a fresh, distinct
    # value, not a reuse.
    retrain_lock_key: int = 447_781_902
    # Below this many real (called_at IS NOT NULL) tokens, /admin/retrain
    # refuses rather than training on noise. 500 is small enough to be
    # reachable in a real early-stage deployment, large enough to be more
    # than a handful of rows -- see docs/api/model-card.md for the full
    # justification.
    retrain_min_real_rows: int = 500
