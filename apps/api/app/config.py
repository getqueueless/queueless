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

    # Short on purpose: queue state moves fast, this only exists to absorb
    # a burst of identical requests (e.g. a screen re-rendering), not to
    # serve stale predictions.
    predict_cache_ttl_seconds: float = 15.0

    # DeepSeek (OpenAI-compatible). api_key is Optional on purpose: every AI
    # route/job must degrade gracefully (not crash) when it's unset -- see
    # app/ai_client.py::get_deepseek_client. Never logged anywhere.
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout_seconds: float = 20.0
    deepseek_max_tokens: int = 400

    translate_cache_size: int = 512

    # Distinct from retrain_lock_key -- advisory lock keys share one global
    # keyspace per Postgres instance.
    daily_summary_lock_key: int = 612_004_337
    daily_summary_hour_ist: int = 21
    daily_summary_timezone: str = "Asia/Kolkata"
