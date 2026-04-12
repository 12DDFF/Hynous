"""
Unit tests for WebSocket price feed integration.

Tests cover:
1. WS fallback logic (MarketDataFeed freshness gating)
2. WS price freshness gating (30s staleness threshold)
3. Config field presence and YAML loading
4. _fast_trigger_check uses provider.get_all_prices() (WS-first)
5. _wake_agent uses provider.get_all_prices() (WS-first)
6. Loop sleep is 1 second
7. Provider WS interface (start_ws, stop_ws, ws_health)
8. Daemon has _update_ws_coins helper
9. PaperProvider passthrough methods exist
"""
import inspect
import time

import pytest


class TestWSFallbackLogic:
    """Test the WS-with-REST-fallback price source selection."""

    def test_uses_ws_when_fresh(self):
        """When WS prices exist and are <30s old, use them."""
        ws_prices = {"BTC": 97000.0, "ETH": 3800.0}
        ws_last_msg = time.time()  # just now
        ws_age = time.time() - ws_last_msg

        should_use_ws = bool(ws_prices) and ws_age < 30
        assert should_use_ws

    def test_falls_back_when_stale(self):
        """When WS prices are >30s old, fall back to REST."""
        ws_prices = {"BTC": 97000.0}
        ws_last_msg = time.time() - 35  # 35 seconds ago

        ws_age = time.time() - ws_last_msg
        should_use_ws = bool(ws_prices) and ws_age < 30
        assert not should_use_ws

    def test_falls_back_when_empty(self):
        """When WS prices dict is empty (cold start), fall back to REST."""
        ws_prices = {}
        ws_last_msg = time.time()

        should_use_ws = bool(ws_prices) and (time.time() - ws_last_msg) < 30
        assert not should_use_ws

    def test_falls_back_when_never_connected(self):
        """When WS has never connected (ws_last_msg=0), fall back."""
        ws_prices = {}
        ws_last_msg = 0.0

        ws_age = time.time() - ws_last_msg if ws_last_msg else float("inf")
        should_use_ws = bool(ws_prices) and ws_age < 30
        assert not should_use_ws


class TestWSMessageParsing:
    """Test parsing of Hyperliquid allMids WebSocket messages."""

    def test_parse_valid_message(self):
        """Valid allMids message should produce float dict."""
        import json

        raw = json.dumps({
            "channel": "allMids",
            "data": {"mids": {"BTC": "97432.5", "ETH": "3821.2", "SOL": "187.4"}}
        })
        data = json.loads(raw)

        assert data.get("channel") == "allMids"
        mids = data["data"]["mids"]
        result = {k: float(v) for k, v in mids.items()}

        assert result == {"BTC": 97432.5, "ETH": 3821.2, "SOL": 187.4}
        assert all(isinstance(v, float) for v in result.values())

    def test_ignore_non_allmids_message(self):
        """Messages from other channels should be ignored."""
        import json

        raw = json.dumps({"channel": "trades", "data": {"coin": "BTC"}})
        data = json.loads(raw)

        assert data.get("channel") != "allMids"

    def test_parse_handles_malformed(self):
        """Malformed messages should not crash."""
        import json

        for bad_raw in ["{}", "not json", '{"channel": "allMids"}']:
            try:
                data = json.loads(bad_raw)
                if data.get("channel") == "allMids":
                    mids = data["data"]["mids"]
                    {k: float(v) for k, v in mids.items()}
            except Exception:
                pass  # Should not crash, just skip


class TestConfigField:
    """Verify ws_price_feed config field exists and loads."""

    def test_daemon_config_has_field(self):
        """DaemonConfig dataclass should have ws_price_feed field."""
        from hynous.core.config import DaemonConfig
        dc = DaemonConfig()
        assert hasattr(dc, "ws_price_feed")
        assert dc.ws_price_feed is True  # default is True

    def test_config_loads_from_yaml(self):
        """load_config should pass ws_price_feed from YAML to DaemonConfig."""
        import inspect
        from hynous.core.config import load_config

        source = inspect.getsource(load_config)
        assert "ws_price_feed" in source, (
            "load_config must pass ws_price_feed to DaemonConfig constructor"
        )


def _daemon_source() -> str:
    """Read daemon.py source directly (avoids intelligence/__init__ importing litellm)."""
    from pathlib import Path
    daemon_path = (
        Path(__file__).parent.parent.parent
        / "src" / "hynous" / "intelligence" / "daemon.py"
    )
    return daemon_path.read_text()


class TestDaemonIntegration:
    """Verify daemon.py uses WS-aware price sources (provider-layer WS)."""

    def test_fast_trigger_check_uses_provider_get_all_prices(self):
        """_fast_trigger_check must call provider.get_all_prices() (WS-first via provider)."""
        source = _daemon_source()
        start = source.find("def _fast_trigger_check(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]

        assert "get_all_prices()" in method_src, (
            "_fast_trigger_check must call get_all_prices() (WS-first via provider)"
        )
        assert "_get_prices_with_ws_fallback" not in method_src, (
            "_get_prices_with_ws_fallback was removed — daemon now delegates WS to provider"
        )

    def test_no_daemon_ws_fallback_helper(self):
        """daemon.py must NOT define _get_prices_with_ws_fallback — logic moved to provider."""
        source = _daemon_source()
        assert "def _get_prices_with_ws_fallback(" not in source, (
            "_get_prices_with_ws_fallback was removed — WS fallback now lives in HyperliquidProvider"
        )

    def test_no_daemon_ws_feed_method(self):
        """daemon.py must NOT define _run_ws_price_feed — replaced by MarketDataFeed."""
        source = _daemon_source()
        assert "def _run_ws_price_feed(" not in source, (
            "_run_ws_price_feed was removed — replaced by MarketDataFeed in ws_feeds.py"
        )

    def test_daemon_has_update_ws_coins(self):
        """daemon.py must define _update_ws_coins() to update feed subscriptions."""
        source = _daemon_source()
        assert "def _update_ws_coins(" in source, (
            "Daemon must have _update_ws_coins() helper to update WS coin subscriptions"
        )

    def test_update_ws_coins_called_on_new_positions(self):
        """_check_positions must call _update_ws_coins() when new entries detected."""
        source = _daemon_source()
        start = source.find("def _check_positions(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        assert "_update_ws_coins()" in method_src, (
            "_check_positions must call _update_ws_coins() on new position entries"
        )

    def test_daemon_starts_ws_via_provider(self):
        """daemon.py must call provider.start_ws() instead of launching its own WS thread."""
        source = _daemon_source()
        assert "provider.start_ws(" in source, (
            "Daemon must start WS via provider.start_ws(), not its own thread"
        )

    def test_loop_sleep_is_1s(self):
        """Main loop sleep should be 1 second, not 10."""
        source = _daemon_source()
        start = source.find("def _loop_inner(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        assert "time.sleep(1)" in method_src, (
            "Main loop must sleep 1s (not 10s) for fast trigger checks"
        )
        assert "time.sleep(10)" not in method_src, (
            "Main loop must not sleep 10s — should be 1s"
        )


class TestWSFreshnessThreshold:
    """Test the 30-second staleness threshold for WS prices."""

    def test_29s_is_fresh(self):
        ws_last_msg = time.time() - 29
        ws_age = time.time() - ws_last_msg
        assert ws_age < 30

    def test_31s_is_stale(self):
        ws_last_msg = time.time() - 31
        ws_age = time.time() - ws_last_msg
        assert ws_age >= 30

    def test_boundary_30s(self):
        ws_last_msg = time.time() - 30
        ws_age = time.time() - ws_last_msg
        # At exactly 30s, should be stale (>= 30, not < 30)
        assert ws_age >= 30


class TestAtomicDictReplacement:
    """Verify the dict replacement pattern is GIL-safe."""

    def test_full_dict_replacement(self):
        """Replacing a dict reference is atomic in CPython (GIL)."""
        # Simulate what on_message does
        ws_prices = {"BTC": 97000.0}
        new_mids = {"BTC": "97500.5", "ETH": "3821.2"}

        # This is an atomic operation — reader sees old or new, never partial
        ws_prices = {k: float(v) for k, v in new_mids.items()}

        assert ws_prices == {"BTC": 97500.5, "ETH": 3821.2}

    def test_empty_to_populated(self):
        """First message populates empty dict."""
        ws_prices = {}
        mids = {"BTC": "97000.0"}
        ws_prices = {k: float(v) for k, v in mids.items()}
        assert ws_prices == {"BTC": 97000.0}

    def test_per_coin_copy_on_write(self):
        """Per-coin l2_books update uses copy-on-write, not in-place mutation."""
        l2_books = {"BTC": {"bids": [], "asks": []}}
        original_ref = l2_books

        # The correct pattern: create new dict, assign coin, replace reference
        coin = "ETH"
        new_book = {"bids": [{"price": 3800.0, "size": 1.0, "orders": 1}], "asks": []}
        new_books = dict(l2_books)
        new_books[coin] = new_book
        l2_books = new_books  # Atomic reference replacement

        # Readers holding original_ref see the old dict untouched
        assert "ETH" not in original_ref
        assert "ETH" in l2_books


class TestMarketDataFeedInterface:
    """Verify MarketDataFeed class exists with the correct public interface."""

    def test_class_exists(self):
        """MarketDataFeed must be importable from ws_feeds."""
        from hynous.data.providers.ws_feeds import MarketDataFeed
        assert MarketDataFeed is not None

    def test_feed_health_dataclass_exists(self):
        """FeedHealth dataclass must be importable from ws_feeds."""
        from hynous.data.providers.ws_feeds import FeedHealth
        feed = FeedHealth()
        assert hasattr(feed, "connected")
        assert hasattr(feed, "last_msg_age")
        assert hasattr(feed, "price_count")
        assert hasattr(feed, "l2_book_coins")
        assert hasattr(feed, "asset_ctx_coins")
        assert hasattr(feed, "reconnect_count")

    def test_market_data_feed_public_api(self):
        """MarketDataFeed must expose the required public methods."""
        from hynous.data.providers.ws_feeds import MarketDataFeed
        feed = MarketDataFeed(coins=["BTC"])

        assert hasattr(feed, "start")
        assert hasattr(feed, "stop")
        assert hasattr(feed, "update_coins")
        assert hasattr(feed, "get_prices")
        assert hasattr(feed, "get_l2_book")
        assert hasattr(feed, "get_asset_ctx")
        assert hasattr(feed, "get_health")
        assert hasattr(feed, "connected")

    def test_get_prices_returns_none_before_connection(self):
        """get_prices() returns None when no WS data received yet."""
        from hynous.data.providers.ws_feeds import MarketDataFeed
        feed = MarketDataFeed(coins=["BTC"])
        # Not started, no data — should return None
        assert feed.get_prices() is None

    def test_get_l2_book_returns_none_before_connection(self):
        """get_l2_book() returns None for unknown coin before WS data."""
        from hynous.data.providers.ws_feeds import MarketDataFeed
        feed = MarketDataFeed(coins=["BTC"])
        assert feed.get_l2_book("BTC") is None

    def test_get_asset_ctx_returns_none_before_connection(self):
        """get_asset_ctx() returns None for unknown coin before WS data."""
        from hynous.data.providers.ws_feeds import MarketDataFeed
        feed = MarketDataFeed(coins=["BTC"])
        assert feed.get_asset_ctx("BTC") is None

    def test_connected_property_false_before_start(self):
        """connected property is False before WS thread starts."""
        from hynous.data.providers.ws_feeds import MarketDataFeed
        feed = MarketDataFeed(coins=["BTC"])
        assert feed.connected is False

    def test_staleness_gating_in_get_prices(self):
        """get_prices() returns None if data older than WS_STALE_THRESHOLD."""
        from hynous.data.providers.ws_feeds import MarketDataFeed, WS_STALE_THRESHOLD
        feed = MarketDataFeed(coins=["BTC"])

        # Inject fresh data directly
        feed._prices = {"BTC": 97000.0}
        feed._prices_time = time.time()
        assert feed.get_prices() is not None

        # Simulate stale data
        feed._prices_time = time.time() - (WS_STALE_THRESHOLD + 1)
        assert feed.get_prices() is None

    def test_staleness_gating_in_get_l2_book(self):
        """get_l2_book() returns None if coin data is stale."""
        from hynous.data.providers.ws_feeds import MarketDataFeed, WS_STALE_THRESHOLD
        feed = MarketDataFeed(coins=["BTC"])

        book = {"bids": [], "asks": [], "best_bid": 97000.0, "best_ask": 97001.0, "mid_price": 97000.5, "spread": 1.0}
        feed._l2_books = {"BTC": book}
        feed._l2_books_time = {"BTC": time.time()}
        assert feed.get_l2_book("BTC") is not None

        feed._l2_books_time = {"BTC": time.time() - (WS_STALE_THRESHOLD + 1)}
        assert feed.get_l2_book("BTC") is None

    def test_update_coins_adds_new_coins(self):
        """update_coins() updates the internal coins list."""
        from hynous.data.providers.ws_feeds import MarketDataFeed
        feed = MarketDataFeed(coins=["BTC"])
        feed.update_coins(["BTC", "ETH", "SOL"])
        assert "ETH" in feed._coins
        assert "SOL" in feed._coins

    def test_get_health_returns_feed_health(self):
        """get_health() returns FeedHealth with correct structure."""
        from hynous.data.providers.ws_feeds import MarketDataFeed, FeedHealth
        feed = MarketDataFeed(coins=["BTC"])
        health = feed.get_health()
        assert isinstance(health, FeedHealth)
        assert health.connected is False
        assert health.price_count == 0


class TestProviderWSInterface:
    """Verify HyperliquidProvider has the WS interface required by daemon."""

    def _provider_source(self) -> str:
        from pathlib import Path
        return (
            Path(__file__).parent.parent.parent
            / "src" / "hynous" / "data" / "providers" / "hyperliquid.py"
        ).read_text()

    def _paper_source(self) -> str:
        from pathlib import Path
        return (
            Path(__file__).parent.parent.parent
            / "src" / "hynous" / "data" / "providers" / "paper.py"
        ).read_text()

    def test_provider_has_start_ws(self):
        """HyperliquidProvider must define start_ws()."""
        source = self._provider_source()
        assert "def start_ws(" in source

    def test_provider_has_stop_ws(self):
        """HyperliquidProvider must define stop_ws()."""
        source = self._provider_source()
        assert "def stop_ws(" in source

    def test_provider_has_ws_health_property(self):
        """HyperliquidProvider must define ws_health property."""
        source = self._provider_source()
        assert "def ws_health" in source

    def test_provider_has_market_feed_field(self):
        """HyperliquidProvider.__init__ must initialize _market_feed."""
        source = self._provider_source()
        assert "_market_feed" in source

    def test_get_all_prices_checks_ws_first(self):
        """get_all_prices() must check WS cache before REST fallback."""
        source = self._provider_source()
        # Extract get_all_prices method
        start = source.find("def get_all_prices(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        assert "_market_feed" in method_src, "get_all_prices must check WS feed first"
        assert "_fetch_all_mids" in method_src, "get_all_prices must have REST fallback"

    def test_get_price_delegates_to_get_all_prices(self):
        """get_price() must delegate to get_all_prices(), not _fetch_all_mids() directly."""
        source = self._provider_source()
        start = source.find("def get_price(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        assert "get_all_prices()" in method_src, (
            "get_price() must call get_all_prices() so it benefits from WS cache"
        )
        assert "_fetch_all_mids" not in method_src, (
            "get_price() must NOT call _fetch_all_mids() directly — bypasses WS cache"
        )

    def test_get_l2_book_checks_ws_first(self):
        """get_l2_book() must check WS cache before REST fallback."""
        source = self._provider_source()
        start = source.find("def get_l2_book(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        assert "_market_feed" in method_src
        assert "l2_snapshot" in method_src, "REST fallback must still be present"

    def test_get_asset_context_checks_ws_first(self):
        """get_asset_context() must check WS cache before REST fallback."""
        source = self._provider_source()
        start = source.find("def get_asset_context(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        assert "_market_feed" in method_src
        assert "meta_and_asset_ctxs" in method_src, "REST fallback must still be present"

    def test_get_multi_asset_contexts_ws_first(self):
        """get_multi_asset_contexts() must check WS per symbol before REST."""
        source = self._provider_source()
        start = source.find("def get_multi_asset_contexts(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        assert "_market_feed" in method_src
        assert "_rest_get_multi_asset_contexts" in method_src

    def test_rest_get_multi_asset_contexts_exists(self):
        """_rest_get_multi_asset_contexts() must exist as private fallback."""
        source = self._provider_source()
        assert "def _rest_get_multi_asset_contexts(" in source

    def test_get_all_asset_contexts_unchanged(self):
        """get_all_asset_contexts() must NOT check WS (fetches full 200+ coin universe)."""
        source = self._provider_source()
        start = source.find("def get_all_asset_contexts(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        # Should go straight to REST — no _market_feed check
        assert "_market_feed" not in method_src, (
            "get_all_asset_contexts() must stay REST-only — WS only tracks 3-5 coins"
        )

    def test_paper_provider_has_start_ws_passthrough(self):
        """PaperProvider must have start_ws() that passes through to real provider."""
        source = self._paper_source()
        assert "def start_ws(" in source
        assert "self._real.start_ws(" in source

    def test_paper_provider_has_stop_ws_passthrough(self):
        """PaperProvider must have stop_ws() that passes through to real provider."""
        source = self._paper_source()
        assert "def stop_ws(" in source
        assert "self._real.stop_ws()" in source

    def test_paper_provider_has_ws_health_passthrough(self):
        """PaperProvider must have ws_health property that passes through to real provider."""
        source = self._paper_source()
        assert "def ws_health" in source
        assert "self._real.ws_health" in source

    def test_no_dangling_ws_state_in_daemon(self):
        """Daemon must not reference old WS state variables."""
        source = _daemon_source()
        assert "_ws_prices" not in source, "_ws_prices was removed — WS state lives in provider"
        assert "_ws_connected" not in source, "_ws_connected was removed — WS state lives in provider"
        assert "_ws_last_msg" not in source, "_ws_last_msg was removed — WS state lives in provider"
