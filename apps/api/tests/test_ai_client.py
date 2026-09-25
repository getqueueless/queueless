"""get_deepseek_client must never construct a client without a key (so
callers can treat None as 'AI unavailable, degrade gracefully') and must
never be handed anything that logs the key."""

from app.ai_client import get_deepseek_client
from app.config import Settings


def _settings(**overrides) -> Settings:
    base = dict(
        supabase_jwt_secret="s" * 32,
        database_url="postgresql://x/y",
        database_url_direct="postgresql://x/y",
    )
    base.update(overrides)
    return Settings(**base)


def test_returns_none_when_api_key_unset():
    settings = _settings(deepseek_api_key=None)
    assert get_deepseek_client(settings) is None


def test_returns_client_when_api_key_set():
    settings = _settings(deepseek_api_key="sk-test-key")
    client = get_deepseek_client(settings)
    assert client is not None
    assert str(client.base_url).rstrip("/") == "https://api.deepseek.com"


def test_client_uses_configured_model_timeout():
    settings = _settings(deepseek_api_key="sk-test-key", deepseek_timeout_seconds=5.0)
    client = get_deepseek_client(settings)
    assert client.timeout == 5.0
