"""EN -> hi/pa translation via DeepSeek. Falls back to the original English
text on ANY failure (unsupported language, no client configured, a
DeepSeek error) -- translation is a nice-to-have layered on top of a real
message, never the reason a push notification or an admin request fails.

Cache: a hand-rolled LRU via OrderedDict (move_to_end on hit, popitem(0) on
overflow) -- no new dependency for what ~10 lines cover. Module-level, same
tradeoff as app/auth.py's role cache: fine for a single-process hackathon
deployment, shared across requests on this worker only.
"""

from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

import structlog

from app.ai_client import timed_completion

log = structlog.get_logger()

SUPPORTED_LANGUAGES = {"hi": "Hindi", "pa": "Punjabi"}


@dataclass(frozen=True)
class TranslateDeps:
    """Bundles what deliver_notification needs to translate a push, so
    notifications.py doesn't thread 4 separate settings values through
    poller_task/listen_task/poll_tick/deliver_notification. None anywhere
    up that call chain (the default) means "don't translate" -- existing
    callers/tests that don't pass this keep working unchanged."""

    client: Any
    model: str
    max_tokens: int
    cache_size: int

_CACHE: "OrderedDict[tuple[str, str], str]" = OrderedDict()


def _cache_get(key: tuple[str, str]) -> str | None:
    if key not in _CACHE:
        return None
    _CACHE.move_to_end(key)
    return _CACHE[key]


def _cache_put(key: tuple[str, str], value: str, max_size: int) -> None:
    _CACHE[key] = value
    _CACHE.move_to_end(key)
    while len(_CACHE) > max_size:
        _CACHE.popitem(last=False)


async def translate_text(client, model: str, max_tokens: int, cache_size: int, text: str, target_lang: str) -> str:
    language_name = SUPPORTED_LANGUAGES.get(target_lang)
    if language_name is None or not text:
        return text

    key = (text, target_lang)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    if client is None:
        return text

    try:
        response = await timed_completion(
            client,
            call_type="translate",
            model=model,
            max_tokens=max_tokens,
            messages=[
                {
                    "role": "system",
                    "content": f"Translate the user's message to {language_name}. "
                    "Reply with ONLY the translation, no notes or quotation marks.",
                },
                {"role": "user", "content": text},
            ],
        )
        translated = response.choices[0].message.content
    except Exception as exc:  # noqa: BLE001 - any DeepSeek failure falls back to English
        log.warning("translate_failed", target_lang=target_lang, error=str(exc))
        return text

    if not translated:
        return text

    _cache_put(key, translated, cache_size)
    return translated
