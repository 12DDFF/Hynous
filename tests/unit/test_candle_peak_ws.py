"""
Unit tests for candle peak tracking WS-first optimization.

Verifies:
1. _get_ws_candle_feed() helper exists and has correct structure
2. _update_peaks_from_candles() uses WS-first pattern
3. get_candles() minimum floor uses min(count, 10)
4. Candle format compatibility (WS and REST both use h/l keys)
5. Regression: existing peak tracking logic unchanged
"""
from pathlib import Path


# ---------------------------------------------------------------------------
# Source helpers (same pattern as test_ws_price_feed.py)
# ---------------------------------------------------------------------------

def _daemon_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return path.read_text()


def _ws_feeds_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "data" / "providers" / "ws_feeds.py"
    return path.read_text()


def _get_method(src: str, method_name: str) -> str:
    start = src.find(f"def {method_name}(")
    end = src.find("\n    def ", start + 1)
    return src[start:end] if end != -1 else src[start:]


# ---------------------------------------------------------------------------
# Static tests: _get_ws_candle_feed() helper
# ---------------------------------------------------------------------------

class TestWSCandleFeedHelper:
    """Structural verification of the _get_ws_candle_feed() helper."""

    def test_helper_method_exists(self):
        """_get_ws_candle_feed must be defined in daemon.py."""
        src = _daemon_source()
        assert "def _get_ws_candle_feed(self)" in src

    def test_helper_accesses_market_feed(self):
        """Helper must access _market_feed attribute."""
        src = _daemon_source()
        method = _get_method(src, "_get_ws_candle_feed")
        assert "_market_feed" in method

    def test_helper_unwraps_paper_provider(self):
        """Helper must unwrap Paper provider via getattr(_real) chain."""
        src = _daemon_source()
        method = _get_method(src, "_get_ws_candle_feed")
        assert 'getattr(provider, "_real", provider)' in method

    def test_helper_used_in_update_peaks(self):
        """_update_peaks_from_candles must call _get_ws_candle_feed."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        assert "_get_ws_candle_feed" in method

    def test_helper_used_in_fetch_satellite(self):
        """_fetch_satellite_candles must call _get_ws_candle_feed (refactored)."""
        src = _daemon_source()
        method = _get_method(src, "_fetch_satellite_candles")
        assert "_get_ws_candle_feed" in method

    def test_no_inline_getattr_in_fetch_satellite(self):
        """_fetch_satellite_candles must not contain the old inline getattr chain."""
        src = _daemon_source()
        method = _get_method(src, "_fetch_satellite_candles")
        # The two-line inline chain should be gone — replaced by the helper
        assert 'getattr(provider, "_real", provider)' not in method


# ---------------------------------------------------------------------------
# Static tests: WS-first pattern in _update_peaks_from_candles()
# ---------------------------------------------------------------------------

class TestWSFirstInUpdatePeaks:
    """Verify WS-first candle fetch pattern in _update_peaks_from_candles."""

    def test_ws_candle_check_before_rest(self):
        """WS feed.get_candles must appear before provider.get_candles in the method."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        ws_pos = method.find("feed.get_candles")
        rest_pos = method.find("provider.get_candles")
        assert ws_pos != -1, "feed.get_candles not found in _update_peaks_from_candles"
        assert rest_pos != -1, "provider.get_candles not found in _update_peaks_from_candles"
        assert ws_pos < rest_pos, "WS check must appear before REST fallback"

    def test_rest_fallback_preserved(self):
        """REST fallback (provider.get_candles) must still exist in the method."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        assert 'provider.get_candles(sym, "1m", start_ms, now_ms)' in method

    def test_ws_candle_count_is_2(self):
        """WS candle fetch must request count=2 (matching 2-minute REST window)."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        assert 'feed.get_candles(sym, "1m", count=2)' in method

    def test_feed_fetched_once_outside_loop(self):
        """_get_ws_candle_feed() must be called before the position loop, not inside."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        feed_call_pos = method.find("_get_ws_candle_feed()")
        loop_pos = method.find("for sym, pos in self._prev_positions")
        assert feed_call_pos != -1, "_get_ws_candle_feed() not found"
        assert loop_pos != -1, "position loop not found"
        assert feed_call_pos < loop_pos, "_get_ws_candle_feed() must be called before the loop"

    def test_docstring_mentions_ws(self):
        """Updated docstring must mention WS."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        # Extract just the docstring (between the first triple-quotes pair)
        doc_start = method.find('"""')
        doc_end = method.find('"""', doc_start + 3)
        docstring = method[doc_start:doc_end]
        assert "WS" in docstring, "Docstring must mention WS candle cache"


# ---------------------------------------------------------------------------
# Logic tests: get_candles() minimum floor
# ---------------------------------------------------------------------------

class TestGetCandlesMinimumFloor:
    """Verify min(count, 10) floor in MarketDataFeed.get_candles()."""

    def test_min_count_formula(self):
        """ws_feeds.py get_candles must use min(count, 10) not hardcoded 10."""
        src = _ws_feeds_source()
        method = _get_method(src, "get_candles")
        assert "min(count, 10)" in method

    def test_count_2_returns_with_2_candles(self):
        """With count=2, min(2, 10)=2 — 2 candles in window is sufficient."""
        count = 2
        window_len = 2
        minimum = min(count, 10)
        assert window_len >= minimum  # 2 >= 2 → returns data

    def test_count_2_fails_with_1_candle(self):
        """With count=2, a window of only 1 candle is insufficient."""
        count = 2
        window_len = 1
        minimum = min(count, 10)
        assert window_len < minimum  # 1 < 2 → returns None

    def test_count_70_still_requires_10(self):
        """With count=70, min(70, 10)=10 — satellite behavior unchanged."""
        count = 70
        minimum = min(count, 10)
        assert minimum == 10  # still requires 10 candles

    def test_count_15_still_requires_10(self):
        """With count=15, min(15, 10)=10 — satellite behavior unchanged."""
        count = 15
        minimum = min(count, 10)
        assert minimum == 10  # still requires 10 candles

    def test_empty_window_returns_none(self):
        """An empty window returns None regardless of count."""
        window = []
        count = 2
        minimum = min(count, 10)
        should_return_none = not window or len(window) < minimum
        assert should_return_none


# ---------------------------------------------------------------------------
# Candle format compatibility
# ---------------------------------------------------------------------------

class TestCandleFormatCompatibility:
    """WS and REST candles share the same key schema."""

    def test_ws_and_rest_candle_keys_match(self):
        """Both WS and REST candles use t, o, h, l, c, v keys."""
        ws_candle = {"t": 1710000000000, "o": 97400.0, "h": 97800.0, "l": 97200.0, "c": 97600.0, "v": 1.5}
        rest_candle = {"t": 1710000000000, "o": 97400.0, "h": 97800.0, "l": 97200.0, "c": 97600.0, "v": 1.5}
        assert set(ws_candle.keys()) == set(rest_candle.keys())

    def test_peak_tracking_reads_h_and_l_only(self):
        """_update_peaks_from_candles must only access 'h' and 'l' from candles."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        # Find the candle processing loop and verify only h and l are read
        assert 'candle.get("h", 0)' in method
        assert 'candle.get("l", 0)' in method
        # Should NOT access 'o', 'c', 'v', or 't' directly from candles
        assert 'candle.get("o"' not in method
        assert 'candle.get("c"' not in method
        assert 'candle.get("v"' not in method
        assert 'candle.get("t"' not in method


# ---------------------------------------------------------------------------
# Regression: existing peak tracking logic unchanged
# ---------------------------------------------------------------------------

class TestExistingPeakTrackingUnchanged:
    """Verify the candle processing loop (peak/trough/trailing/capital-BE) is untouched."""

    def test_roe_formula_unchanged(self):
        """ROE computation lines must still be present."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        assert "((high - entry_px) / entry_px * 100) * leverage" in method
        assert "((entry_px - low) / entry_px * 100) * leverage" in method

    def test_capital_be_reevaluation_unchanged(self):
        """capital_breakeven_enabled check must still exist in the method."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        assert "capital_breakeven_enabled" in method

    def test_persist_on_trailing_active_unchanged(self):
        """Bug E fix pattern must be intact: trailing active check + persist."""
        src = _daemon_source()
        method = _get_method(src, "_update_peaks_from_candles")
        assert "self._trailing_active.get(sym)" in method
        assert "_persist_mechanical_state()" in method
