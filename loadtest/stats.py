"""Pure helpers for load_test.py -- percentile math and duplicate detection.
No network, no DB: testable standalone, which is the whole point of
splitting these out of the orchestration script."""

from collections import Counter


def percentile(sorted_values: list[float], p: float) -> float:
    """Nearest-rank percentile over an already-sorted list. p in [0, 100].
    Returns 0.0 for an empty list rather than raising -- a load test with
    zero successful requests should still print a report, not crash on it."""
    if not sorted_values:
        return 0.0
    if p <= 0:
        return sorted_values[0]
    if p >= 100:
        return sorted_values[-1]
    index = max(0, min(len(sorted_values) - 1, int(round(p / 100 * len(sorted_values))) - 1))
    return sorted_values[index]


def summarize_latencies(latencies_ms: list[float]) -> dict:
    ordered = sorted(latencies_ms)
    return {
        "count": len(ordered),
        "p50_ms": round(percentile(ordered, 50), 1),
        "p95_ms": round(percentile(ordered, 95), 1),
        "p99_ms": round(percentile(ordered, 99), 1),
        "min_ms": round(ordered[0], 1) if ordered else 0.0,
        "max_ms": round(ordered[-1], 1) if ordered else 0.0,
    }


def find_duplicates(values: list) -> list:
    """Returns each value that appeared more than once, in first-seen order.
    Used for both token `number`s (issue_token) and token `id`s across the
    two parallel call_next loops (a double-call)."""
    counts = Counter(values)
    seen = []
    for v in values:
        if counts[v] > 1 and v not in seen:
            seen.append(v)
    return seen


def demo() -> None:
    assert percentile([], 50) == 0.0
    assert percentile([10], 50) == 10
    assert percentile(list(range(1, 101)), 50) == 50  # 50th of 1..100
    assert percentile(list(range(1, 101)), 95) == 95
    assert percentile(list(range(1, 101)), 99) == 99
    assert percentile(list(range(1, 101)), 100) == 100
    assert percentile(list(range(1, 101)), 0) == 1

    summary = summarize_latencies([100.0, 200.0, 300.0])
    assert summary["count"] == 3
    assert summary["min_ms"] == 100.0
    assert summary["max_ms"] == 300.0

    assert find_duplicates([1, 2, 3]) == []
    assert find_duplicates([1, 2, 2, 3, 1]) == [1, 2]
    assert find_duplicates([]) == []

    print("stats.py demo: all assertions passed")


if __name__ == "__main__":
    demo()
