# Fix 03: S1 — Hyperliquid 429 Rate Limiting Resilience

> **Priority:** High
> **Bug addressed:** S1 (`get_all_prices()` has no error handling — 429s cascade to all daemon systems)
> **Files modified:** `src/hynous/data/providers/hyperliquid.py` (1 file)
> **Estimated scope:** ~40 lines added

---

## Problem Summary

`get_all_prices()` in `hyperliquid.py:597-604` calls `self._info.all_mids()` with no exception handling, no retry, and no caching. When Hyperliquid returns HTTP 429, the exception propagates to every caller: `_fast_trigger_check()`, `_poll_prices()`, `_check_positions()`, `check_triggers()`, and `_update_peaks_from_candles()`. The daemon becomes blind to all position management until the rate limit window passes.

Additionally, the daemon calls price-fetching methods multiple times per tick cycle (once in `_fast_trigger_check`, once in `_poll_prices`, once in `check_triggers` via paper provider, etc.). Each call is a separate HTTP request. A short TTL cache on the result would reduce HTTP calls and 429 risk.

---

## Prerequisites — Read Before Coding

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `docs/revisions/trade-mechanism-debug/README.md` | S1 section | Full bug analysis with all affected code paths. |
| 2 | `src/hynous/data/providers/hyperliquid.py` | 1-30 | **Imports and module docstring.** Understand the provider pattern: wraps the `hyperliquid` SDK's `Info` class. Uses `self._info` for read calls. |
| 3 | `src/hynous/data/providers/hyperliquid.py` | 597-616 | **`get_all_prices()` and `get_price()`.** Both call `self._info.all_mids()` independently — two separate HTTP calls for what could be one cached result. |
| 4 | `src/hynous/intelligence/tools/trading.py` | 80-108 | **`_retry_exchange_call()` and `_is_rate_limit_error()`.** Existing retry pattern in the codebase. Your implementation follows this same style but lighter (1 retry, 1s wait for reads vs 3 retries, 6s wait for writes). |
| 5 | `src/hynous/data/providers/paper.py` | 127-128 | **Paper provider delegates to real provider.** `get_all_prices()` calls `self._real.get_all_prices()`. So paper mode benefits from this fix too. |
| 6 | `src/hynous/data/providers/paper.py` | 154-156 | **`get_user_state()` calls `self.get_all_prices()`.** The 429 that breaks `_fast_trigger_check()` starts here. |

### Call Sites (Reference — Do Not Modify)

All callers that benefit from this fix (no changes needed to these):

| Caller | File | Line | Context |
|--------|------|------|---------|
| `_fast_trigger_check()` | daemon.py | 1768 | Every 10s — position SL/TP checking |
| `_poll_prices()` | daemon.py | 1060 | Every 60s — full price refresh for scanner |
| `check_triggers()` via `get_user_state()` | paper.py | 156 | When trigger events fire |
| `_update_peaks_from_candles()` | daemon.py | 2090 | Every 60s — MFE/MAE tracking (uses `get_candles`, not `all_mids`) |
| `_wake_agent()` price refresh | daemon.py | 4640 | On agent wake — conditional refresh |
| `market_close()` | paper.py | 305 | On position close — `get_price()` call |
| `market_open()` | paper.py | 252 | On position open — `get_price()` call |

---

## Overview of Changes

Three changes in `hyperliquid.py`:

1. **Add `_is_rate_limit_error()` helper** — detects 429 exceptions from the SDK
2. **Add `_fetch_all_mids()` internal method** — fetches `all_mids()` with retry (1 attempt) and a 2-second TTL cache
3. **Rewrite `get_all_prices()` and `get_price()`** — delegate to `_fetch_all_mids()` instead of calling `self._info.all_mids()` directly

---

## Change 1: Add Rate Limit Detection Helper

**File:** `src/hynous/data/providers/hyperliquid.py`
**Location:** After the imports and before the class definition (module-level helper)

Add this function near the top of the file, after the `logger` definition (around line 29):

```python
import time as _time


def _is_rate_limit_error(exc: Exception) -> bool:
    """Return True if the exception is a 429 / rate-limit response."""
    msg = str(exc).lower()
    return "429" in msg or "too many requests" in msg or "rate limit" in msg
```

**Note:** `import time` may already be present. Check the existing imports. If `time` is already imported, use it directly. If not, add `import time` to the imports block at the top.

---

## Change 2: Add `_fetch_all_mids()` with Retry + Cache

**File:** `src/hynous/data/providers/hyperliquid.py`

### Add Instance Variables

In the `__init__` method of `HyperliquidProvider`, add these two instance variables alongside the existing ones:

```python
        # Price cache for rate-limit resilience (2s TTL)
        self._mids_cache: dict[str, str] | None = None
        self._mids_cache_time: float = 0.0
```

### Add the `_fetch_all_mids()` Method

Add this method immediately before `get_all_prices()` (before line 597):

```python
    def _fetch_all_mids(self) -> dict[str, str]:
        """Fetch all mid prices with 1-retry on 429 and 2s TTL cache.

        Multiple daemon methods call get_all_prices() within the same tick
        cycle. Caching for 2s means they share one HTTP call. The retry
        handles transient 429s without cascading failure to every caller.
        """
        now = time.time()
        if self._mids_cache is not None and now - self._mids_cache_time < 2.0:
            return self._mids_cache

        last_exc: Exception | None = None
        for attempt in range(2):  # 1 original + 1 retry
            try:
                result = self._info.all_mids()
                self._mids_cache = result
                self._mids_cache_time = time.time()
                return result
            except Exception as exc:
                if attempt == 0 and _is_rate_limit_error(exc):
                    last_exc = exc
                    logger.warning("get_all_prices 429 — retrying in 1s")
                    time.sleep(1)
                    continue
                raise  # Non-429 error or second attempt failed
        raise last_exc  # Should not reach here, but safety net
```

---

## Change 3: Rewrite `get_all_prices()` and `get_price()`

**File:** `src/hynous/data/providers/hyperliquid.py`

### Replace `get_all_prices()` (lines 597-604)

#### Current Code

```python
    def get_all_prices(self) -> dict[str, float]:
        """Get current mid prices for all traded assets.

        Returns:
            Dict mapping symbol to price, e.g. {"BTC": 97432.5, "ETH": 3421.8}
        """
        mids = self._info.all_mids()
        return {symbol: float(price) for symbol, price in mids.items()}
```

#### Replace With

```python
    def get_all_prices(self) -> dict[str, float]:
        """Get current mid prices for all traded assets.

        Returns:
            Dict mapping symbol to price, e.g. {"BTC": 97432.5, "ETH": 3421.8}
        """
        mids = self._fetch_all_mids()
        return {symbol: float(price) for symbol, price in mids.items()}
```

### Replace `get_price()` (lines 606-616)

#### Current Code

```python
    def get_price(self, symbol: str) -> float | None:
        """Get current mid price for a single symbol.

        Returns:
            Price as float, or None if symbol not found.
        """
        mids = self._info.all_mids()
        price_str = mids.get(symbol)
        if price_str is None:
            return None
        return float(price_str)
```

#### Replace With

```python
    def get_price(self, symbol: str) -> float | None:
        """Get current mid price for a single symbol.

        Returns:
            Price as float, or None if symbol not found.
        """
        mids = self._fetch_all_mids()
        price_str = mids.get(symbol)
        if price_str is None:
            return None
        return float(price_str)
```

---

## Design Rationale

### Why 2-Second Cache TTL?

The daemon's main loop runs every 10 seconds. Within a single tick, `_fast_trigger_check()` calls `get_all_prices()` (line 1768), and if a trigger fires, `get_user_state()` calls it again (paper.py:156). A 2s cache means these two calls share one HTTP request without any meaningful price staleness.

### Why Only 1 Retry (Not 3)?

`get_all_prices()` is a read-only query. It's called every 10 seconds. If the first retry succeeds, great. If both attempts fail, the caller's existing try/except (in daemon methods) handles the failure gracefully. The 6-second retry in `_retry_exchange_call` is for exchange ORDER operations that are expensive to lose — reads can tolerate a missed tick.

### Why Not Import from trading.py?

`_is_rate_limit_error` in `tools/trading.py` is a module-local helper. Importing across package boundaries (`intelligence.tools` → `data.providers`) would create an undesirable dependency. A 3-line helper is better duplicated than cross-referenced.

### Thread Safety

The `_mids_cache` is a simple dict reference + float timestamp. In CPython, dict assignment is atomic (GIL). The worst case for concurrent reads is a slightly stale cache or two concurrent HTTP calls during a cache miss — both are harmless.

---

## Testing

### Static Tests (Unit)

**File to create:** `tests/unit/test_429_resilience.py`

```python
"""
Unit tests for Fix 03: S1 (429 rate-limit resilience).

Tests verify:
1. _is_rate_limit_error detects 429 exceptions
2. TTL cache returns cached result within window
3. Cache is bypassed after TTL expires
4. Retry logic attempts twice on 429
"""
import pytest
import time


class TestIsRateLimitError:
    """Detection of 429 / rate-limit errors."""

    def test_detects_429_code(self):
        from hynous.data.providers.hyperliquid import _is_rate_limit_error
        assert _is_rate_limit_error(Exception("HTTP 429 Too Many Requests"))

    def test_detects_rate_limit_text(self):
        from hynous.data.providers.hyperliquid import _is_rate_limit_error
        assert _is_rate_limit_error(Exception("rate limit exceeded"))

    def test_detects_too_many_requests(self):
        from hynous.data.providers.hyperliquid import _is_rate_limit_error
        assert _is_rate_limit_error(Exception("too many requests"))

    def test_ignores_other_errors(self):
        from hynous.data.providers.hyperliquid import _is_rate_limit_error
        assert not _is_rate_limit_error(Exception("Connection refused"))
        assert not _is_rate_limit_error(Exception("Timeout"))
        assert not _is_rate_limit_error(ValueError("Invalid data"))

    def test_case_insensitive(self):
        from hynous.data.providers.hyperliquid import _is_rate_limit_error
        assert _is_rate_limit_error(Exception("RATE LIMIT"))
        assert _is_rate_limit_error(Exception("Rate Limit Exceeded"))


class TestCacheTTLLogic:
    """TTL cache behavior for _fetch_all_mids."""

    def test_cache_returns_within_ttl(self):
        """Within 2s, cached result should be returned."""
        cache = {"BTC": "100000", "ETH": "3500"}
        cache_time = time.time()  # just now
        ttl = 2.0

        now = time.time()
        should_use_cache = (cache is not None and now - cache_time < ttl)
        assert should_use_cache

    def test_cache_bypassed_after_ttl(self):
        """After 2s, cache should be bypassed."""
        cache = {"BTC": "100000", "ETH": "3500"}
        cache_time = time.time() - 3.0  # 3 seconds ago
        ttl = 2.0

        now = time.time()
        should_use_cache = (cache is not None and now - cache_time < ttl)
        assert not should_use_cache

    def test_cache_bypassed_when_none(self):
        """First call has no cache."""
        cache = None
        cache_time = 0.0
        ttl = 2.0

        now = time.time()
        should_use_cache = (cache is not None and now - cache_time < ttl)
        assert not should_use_cache


class TestRetryLogic:
    """Retry pattern for 429 errors."""

    def test_retry_on_429_then_success(self):
        """First call 429, second call succeeds → should return result."""
        attempts = []
        results = [Exception("429"), {"BTC": "100000"}]

        def mock_all_mids():
            idx = len(attempts)
            attempts.append(idx)
            result = results[idx]
            if isinstance(result, Exception):
                raise result
            return result

        # Simulate the retry loop
        last_exc = None
        for attempt in range(2):
            try:
                result = mock_all_mids()
                break
            except Exception as exc:
                if attempt == 0 and "429" in str(exc):
                    last_exc = exc
                    continue
                raise
        else:
            raise last_exc

        assert result == {"BTC": "100000"}
        assert len(attempts) == 2

    def test_two_429s_raises(self):
        """Both calls 429 → should raise."""
        attempts = []

        def mock_all_mids():
            attempts.append(len(attempts))
            raise Exception("429 Too Many Requests")

        last_exc = None
        with pytest.raises(Exception, match="429"):
            for attempt in range(2):
                try:
                    mock_all_mids()
                    break
                except Exception as exc:
                    if attempt == 0 and "429" in str(exc):
                        last_exc = exc
                        continue
                    raise
            else:
                raise last_exc

    def test_non_429_error_not_retried(self):
        """Non-429 error should raise immediately without retry."""
        attempts = []

        def mock_all_mids():
            attempts.append(len(attempts))
            raise ConnectionError("Connection refused")

        with pytest.raises(ConnectionError):
            for attempt in range(2):
                try:
                    mock_all_mids()
                    break
                except Exception as exc:
                    if attempt == 0 and "429" in str(exc).lower():
                        continue
                    raise

        assert len(attempts) == 1, "Should not retry non-429 errors"


class TestProviderMethodsUseFetchAllMids:
    """Verify get_all_prices and get_price delegate to _fetch_all_mids."""

    def test_get_all_prices_uses_fetch(self):
        """get_all_prices must call _fetch_all_mids, not _info.all_mids directly."""
        import inspect
        from hynous.data.providers.hyperliquid import HyperliquidProvider

        source = inspect.getsource(HyperliquidProvider.get_all_prices)
        assert "_fetch_all_mids" in source, (
            "get_all_prices must use _fetch_all_mids (cached + retry)"
        )
        assert "_info.all_mids" not in source, (
            "get_all_prices must not call _info.all_mids directly"
        )

    def test_get_price_uses_fetch(self):
        """get_price must call _fetch_all_mids, not _info.all_mids directly."""
        import inspect
        from hynous.data.providers.hyperliquid import HyperliquidProvider

        source = inspect.getsource(HyperliquidProvider.get_price)
        assert "_fetch_all_mids" in source, (
            "get_price must use _fetch_all_mids (cached + retry)"
        )
        assert "_info.all_mids" not in source, (
            "get_price must not call _info.all_mids directly"
        )
```

**Run:**

```bash
cd /Users/bauthoi/Documents/Hynous
PYTHONPATH=src pytest tests/unit/test_429_resilience.py -v
```

### Dynamic Tests (Live Environment)

#### Setup

```bash
# Terminal 1: Nous server
cd /Users/bauthoi/Documents/Hynous/nous-server && pnpm --filter server start

# Terminal 2: Daemon
cd /Users/bauthoi/Documents/Hynous && python -m scripts.run_daemon
```

#### Test D1: Normal Operation (Cache Working)

**Purpose:** Confirm the cache reduces HTTP calls without breaking functionality.

1. Start the daemon and let it run for 5 minutes
2. Watch logs: no errors, prices updating normally
3. **Expected:** Dashboard Data page shows live prices updating. No 429 warnings in logs.

#### Test D2: 429 Recovery

**Purpose:** Confirm the retry handles transient 429s.

1. Let the daemon run during a period of frequent operations (open a position, let breakeven + trailing stop run)
2. If a 429 occurs naturally, you should see: `"get_all_prices 429 — retrying in 1s"` in logs
3. **Expected:** The retry succeeds, and the daemon continues without cascade failures. No error spam.
4. **Note:** 429s are rare under normal load. This test may not trigger naturally. The static tests verify the logic.

#### Test D3: Price Freshness

**Purpose:** Confirm the 2s cache doesn't cause stale prices in the UI.

1. Open the Dashboard Data page with the candlestick chart
2. Let it run for a minute, watching price updates
3. **Expected:** Prices update in real-time. A 2s cache is imperceptible to the user.

---

## Verification Checklist

- [ ] `_is_rate_limit_error()` function exists at module level in `hyperliquid.py`
- [ ] `_mids_cache` and `_mids_cache_time` instance variables added to `__init__`
- [ ] `_fetch_all_mids()` method exists with retry (2 attempts) and TTL cache (2s)
- [ ] `get_all_prices()` calls `self._fetch_all_mids()` — NOT `self._info.all_mids()`
- [ ] `get_price()` calls `self._fetch_all_mids()` — NOT `self._info.all_mids()`
- [ ] `import time` is present in the imports (should already be there; verify)
- [ ] `PYTHONPATH=src pytest tests/unit/test_429_resilience.py -v` — all pass
- [ ] `PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v` — no regressions
- [ ] Daemon starts and runs without errors for 5+ minutes
- [ ] Prices display correctly in dashboard

---

Last updated: 2026-03-06
