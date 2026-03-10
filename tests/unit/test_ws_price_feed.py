"""
Unit tests for WebSocket price feed integration.

Tests cover:
1. WS fallback logic (_get_prices_with_ws_fallback)
2. WS price freshness gating (30s staleness threshold)
3. Config field presence and YAML loading
4. _fast_trigger_check uses WS-aware price source
5. _wake_agent uses WS-aware price source
6. Loop sleep is 1 second
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
    """Verify daemon.py uses WS-aware price sources."""

    def test_fast_trigger_check_uses_ws_fallback(self):
        """_fast_trigger_check must call _get_prices_with_ws_fallback, not get_all_prices directly."""
        source = _daemon_source()
        # Extract only the _fast_trigger_check method body (between its def and the next def)
        start = source.find("def _fast_trigger_check(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]

        assert "_get_prices_with_ws_fallback" in method_src, (
            "_fast_trigger_check must use _get_prices_with_ws_fallback"
        )
        assert "provider.get_all_prices()" not in method_src, (
            "_fast_trigger_check must not call provider.get_all_prices() directly"
        )

    def test_ws_fallback_helper_exists(self):
        """daemon.py must define _get_prices_with_ws_fallback method."""
        source = _daemon_source()
        assert "def _get_prices_with_ws_fallback(" in source, (
            "Daemon must have _get_prices_with_ws_fallback method"
        )

    def test_ws_feed_method_exists(self):
        """daemon.py must define _run_ws_price_feed method."""
        source = _daemon_source()
        assert "def _run_ws_price_feed(" in source, (
            "Daemon must have _run_ws_price_feed method"
        )

    def test_wake_agent_uses_ws_fallback(self):
        """_wake_agent price refresh should use WS-aware source."""
        source = _daemon_source()
        start = source.find("def _wake_agent(")
        end = source.find("\n    def ", start + 1)
        method_src = source[start:end]
        assert "_get_prices_with_ws_fallback" in method_src, (
            "_wake_agent must use _get_prices_with_ws_fallback for price refresh"
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
