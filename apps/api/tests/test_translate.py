"""translate_text falls back to the original English text on ANY failure
(unsupported language, no client, DeepSeek error) -- a push notification or
an admin request must never fail because translation did. The LRU cache is
hand-rolled (OrderedDict), no new dependency."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.translate import translate_text


def _fake_client(translated: str):
    client = SimpleNamespace()
    client.chat = SimpleNamespace()
    client.chat.completions = SimpleNamespace()
    response = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=translated))])
    client.chat.completions.create = AsyncMock(return_value=response)
    return client


async def test_unsupported_language_returns_original_text_unchanged():
    result = await translate_text(_fake_client("should never be called"), "deepseek-chat", 100, 8, "hello", "fr")
    assert result == "hello"


async def test_no_client_falls_back_to_original_text():
    result = await translate_text(None, "deepseek-chat", 100, 8, "hello", "hi")
    assert result == "hello"


async def test_translates_via_client():
    client = _fake_client("नमस्ते")
    result = await translate_text(client, "deepseek-chat", 100, 8, "hello", "hi")
    assert result == "नमस्ते"


async def test_client_error_falls_back_to_original_text():
    # Distinct text from other tests -- _CACHE is module-level, shared
    # across the whole test session (same tradeoff as app/auth.py's role
    # cache); a shared key here would hit another test's cached result
    # instead of exercising this error path at all.
    client = SimpleNamespace()
    client.chat = SimpleNamespace()
    client.chat.completions = SimpleNamespace()

    async def _boom(*a, **kw):
        raise RuntimeError("network exploded")

    client.chat.completions.create = _boom
    result = await translate_text(client, "deepseek-chat", 100, 8, "hello error test", "hi")
    assert result == "hello error test"


async def test_cache_hit_does_not_call_client_again():
    client = _fake_client("नमस्ते")
    first = await translate_text(client, "deepseek-chat", 100, 8, "hello cache test", "hi")
    second = await translate_text(client, "deepseek-chat", 100, 8, "hello cache test", "hi")
    assert first == second == "नमस्ते"
    assert client.chat.completions.create.await_count == 1


async def test_cache_evicts_oldest_beyond_max_size():
    client = _fake_client("x")
    for i in range(5):
        await translate_text(client, "deepseek-chat", 100, 2, f"evict-test-{i}", "hi")
    assert client.chat.completions.create.await_count == 5
    # Re-request the first (long since evicted, cache size 2) -- must call again.
    await translate_text(client, "deepseek-chat", 100, 2, "evict-test-0", "hi")
    assert client.chat.completions.create.await_count == 6
