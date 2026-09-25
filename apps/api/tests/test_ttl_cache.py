"""Hand-rolled TTL cache -- no new dependency for what a dict + expiry
timestamps covers. Used by /predict to avoid recomputing the same
prediction on every request within a short window."""

from app.ttl_cache import TTLCache


def test_miss_then_hit():
    cache = TTLCache(ttl_seconds=60, now=lambda: 1000.0)
    assert cache.get("k") is None
    cache.set("k", "v")
    assert cache.get("k") == "v"


def test_expires_after_ttl():
    t = {"now": 1000.0}
    cache = TTLCache(ttl_seconds=10, now=lambda: t["now"])
    cache.set("k", "v")
    assert cache.get("k") == "v"
    t["now"] = 1011.0  # 11s later, past the 10s TTL
    assert cache.get("k") is None


def test_exactly_at_ttl_boundary_is_expired():
    t = {"now": 1000.0}
    cache = TTLCache(ttl_seconds=10, now=lambda: t["now"])
    cache.set("k", "v")
    t["now"] = 1010.0  # exactly at the boundary -- must not still be valid
    assert cache.get("k") is None


def test_max_size_evicts_oldest_entry():
    cache = TTLCache(ttl_seconds=60, max_size=2, now=lambda: 1000.0)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    assert cache.get("a") is None
    assert cache.get("b") == 2
    assert cache.get("c") == 3
