"""DeepSeek client, via the OpenAI-compatible chat completions API
(base_url swapped, same SDK). Every caller must treat get_deepseek_client's
None return as "AI unavailable" and fall back gracefully -- never crash a
request because the key isn't configured.

The key is NEVER logged: it's read here from Settings (itself read once
from the environment) and handed straight to the SDK's constructor. No
function in this module accepts or returns the raw key string, and no log
call anywhere in this codebase should reference `settings.deepseek_api_key`
or a client's `.api_key` attribute -- grep for both before adding one.
"""

from openai import AsyncOpenAI

from app.config import Settings


def get_deepseek_client(settings: Settings) -> AsyncOpenAI | None:
    if not settings.deepseek_api_key:
        return None
    return AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
        timeout=settings.deepseek_timeout_seconds,
    )
