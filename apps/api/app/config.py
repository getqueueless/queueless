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
