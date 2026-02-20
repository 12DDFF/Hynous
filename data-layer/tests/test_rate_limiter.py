"""Tests for token bucket rate limiter."""

import time
import threading

from hynous_data.core.rate_limiter import RateLimiter


def test_initial_tokens():
    rl = RateLimiter(max_weight=1200, safety_pct=100)
    assert rl.available == 1200.0


def test_acquire_deducts_tokens():
    rl = RateLimiter(max_weight=100, safety_pct=100)
    assert rl.acquire(10, timeout=1)
    assert rl.available < 100


def test_acquire_multiple():
    rl = RateLimiter(max_weight=100, safety_pct=100)
    for _ in range(10):
        assert rl.acquire(10, timeout=1)
    # Should be near 0 now
    assert rl.available < 5


def test_safety_pct():
    rl = RateLimiter(max_weight=1200, safety_pct=85)
    # Effective max should be 1020
    assert rl._max == 1020


def test_refill_over_time():
    rl = RateLimiter(max_weight=60, safety_pct=100)
    # Drain all tokens
    rl.acquire(60, timeout=1)
    assert rl.available < 2
    # Wait 1 second — should refill ~1 token (60/60 = 1/sec)
    time.sleep(1.1)
    assert rl.available >= 0.9


def test_timeout_returns_false():
    rl = RateLimiter(max_weight=10, safety_pct=100)
    rl.acquire(10, timeout=1)
    # Try to acquire more than available with short timeout
    result = rl.acquire(20, timeout=0.1)
    assert result is False


def test_thread_safety():
    rl = RateLimiter(max_weight=1200, safety_pct=100)
    results = []

    def worker():
        for _ in range(50):
            ok = rl.acquire(2, timeout=5)
            results.append(ok)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # All should succeed (200 total weight, 1200 available)
    assert len(results) == 200
    assert all(results)


def test_stats():
    rl = RateLimiter(max_weight=100, safety_pct=100)
    rl.acquire(10, timeout=1)
    s = rl.stats()
    assert s["total_acquired"] == 10
    assert s["max"] == 100
    assert "available" in s
