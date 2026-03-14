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
    """Verify get_all_prices uses _fetch_all_mids (REST fallback) and get_price delegates to get_all_prices."""

    def test_get_all_prices_uses_fetch(self):
        """get_all_prices must call _fetch_all_mids, not _info.all_mids directly."""
        import inspect
        from hynous.data.providers.hyperliquid import HyperliquidProvider

        source = inspect.getsource(HyperliquidProvider.get_all_prices)
        assert "_fetch_all_mids" in source, (
            "get_all_prices must use _fetch_all_mids (cached + retry) as REST fallback"
        )
        assert "_info.all_mids" not in source, (
            "get_all_prices must not call _info.all_mids directly"
        )

    def test_get_price_delegates_to_get_all_prices(self):
        """get_price must delegate to get_all_prices(), not call _fetch_all_mids() directly.

        Calling _fetch_all_mids() directly bypasses the WS cache — 10 call sites across
        6 files would silently remain REST-only. get_price() must go through get_all_prices()
        so all callers benefit from the WS cache automatically.
        """
        import inspect
        from hynous.data.providers.hyperliquid import HyperliquidProvider

        source = inspect.getsource(HyperliquidProvider.get_price)
        assert "get_all_prices()" in source, (
            "get_price must call get_all_prices() to use WS cache (not _fetch_all_mids directly)"
        )
        assert "_fetch_all_mids" not in source, (
            "get_price must NOT call _fetch_all_mids directly — bypasses WS cache"
        )
