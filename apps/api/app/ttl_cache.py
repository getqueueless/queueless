"""Hand-rolled TTL cache: a dict of value + expiry timestamp, evicting the
oldest entry (by insertion order) once max_size is exceeded. No new
dependency for what this covers -- same reasoning as app/translate.py's
hand-rolled LRU. Used by /predict to avoid recomputing an identical
prediction on every request within a short window; NOT used anywhere
correctness-sensitive, since a short-TTL cache means a caller can see
queue state that's up to `ttl_seconds` stale.
"""

import time
from collections import OrderedDict
from typing import Any, Callable


class TTLCache:
    def __init__(self, ttl_seconds: float, max_size: int = 1000, now: Callable[[], float] = time.monotonic):
        self._ttl = ttl_seconds
        self._max_size = max_size
        self._now = now
        self._store: "OrderedDict[Any, tuple[Any, float]]" = OrderedDict()

    def get(self, key: Any) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if self._now() >= expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: Any, value: Any) -> None:
        self._store[key] = (value, self._now() + self._ttl)
        self._store.move_to_end(key)
        while len(self._store) > self._max_size:
            self._store.popitem(last=False)
