"""
Unit tests for Agent Exit Lockout — full autonomous close disable.

Verifies:
A. close_position autonomous lockout (6 tests)
B. modify_position autonomous lockout (4 tests)
C. TP widening guard (4 tests)
D. Config flag (2 tests)
"""
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Source / config helpers (same pattern as test_ml_adaptive_trailing.py)
# ---------------------------------------------------------------------------

def _trading_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "tools" / "trading.py"
    return path.read_text()


def _settings_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "core" / "trading_settings.py"
    return path.read_text()


def _default_yaml() -> dict:
    import yaml
    path = Path(__file__).parent.parent.parent / "config" / "default.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def _builder_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "prompts" / "builder.py"
    return path.read_text()


def _daemon_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return path.read_text()


def _scanner_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "scanner.py"
    return path.read_text()


def _wake_warnings_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "wake_warnings.py"
    return path.read_text()


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------

def _mock_tracer(source: str):
    """Create mock patches for get_active_trace and get_tracer returning the given source."""
    trace_id = "test-trace-123"
    tracer_mock = MagicMock()
    tracer_mock._active = {trace_id: {"source": source}}
    return trace_id, tracer_mock


def _make_provider_mock(position_side="long", mark_px=70000, entry_px=69000, size=0.1):
    """Create a mock provider with a position."""
    provider = MagicMock()
    provider.can_trade = True
    provider.get_user_state.return_value = {
        "positions": [{
            "coin": "BTC",
            "side": position_side,
            "size": size,
            "entry_px": entry_px,
            "mark_px": mark_px,
            "leverage": 15,
            "return_pct": 1.0,
        }],
        "account_value": 1000,
    }
    provider.get_trigger_orders.return_value = []
    return provider


# ---------------------------------------------------------------------------
# A. close_position autonomous lockout (6 tests)
# ---------------------------------------------------------------------------

class TestClosePositionAutonomousLockout:
    """Verify close_position is blocked from daemon wakes but allowed from user chat."""

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_close_blocked_from_daemon_wake(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """1. Daemon wake source → BLOCKED."""
        from hynous.intelligence.tools.trading import handle_close_position
        provider = _make_provider_mock()
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = True
        mock_ts.return_value = ts
        trace_id, tracer = _mock_tracer("daemon:profit")
        mock_gat.return_value = trace_id
        mock_gt.return_value = tracer

        result = handle_close_position(symbol="BTC", reasoning="thesis invalidated")
        assert "BLOCKED" in result
        assert "autonomous" in result.lower()

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_close_allowed_from_user_chat(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """2. User chat source → NOT blocked (may fail on later checks, but passes lockout)."""
        from hynous.intelligence.tools.trading import handle_close_position
        provider = _make_provider_mock()
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = True
        mock_ts.return_value = ts
        trace_id, tracer = _mock_tracer("user_chat")
        mock_gat.return_value = trace_id
        mock_gt.return_value = tracer

        result = handle_close_position(symbol="BTC", reasoning="user wants out")
        assert "BLOCKED" not in result or "autonomous" not in result.lower()

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_close_allowed_when_lockout_disabled(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """3. Lockout disabled → daemon source passes through."""
        from hynous.intelligence.tools.trading import handle_close_position
        provider = _make_provider_mock()
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = False
        mock_ts.return_value = ts
        trace_id, tracer = _mock_tracer("daemon:profit")
        mock_gat.return_value = trace_id
        mock_gt.return_value = tracer

        result = handle_close_position(symbol="BTC", reasoning="thesis invalidated")
        # Should not be blocked by autonomous lockout (may hit trailing lockout or proceed)
        assert "autonomous" not in result.lower()

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_close_allowed_when_tracer_unavailable(self, mock_ts, mock_gat, mock_prov):
        """4. No active trace → safety fallback allows close."""
        from hynous.intelligence.tools.trading import handle_close_position
        provider = _make_provider_mock()
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = True
        mock_ts.return_value = ts
        mock_gat.return_value = None  # No active trace

        result = handle_close_position(symbol="BTC", reasoning="closing")
        assert "autonomous" not in result.lower()

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_close_blocked_all_daemon_sources(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """5. All daemon:* sources are blocked."""
        from hynous.intelligence.tools.trading import handle_close_position
        daemon_sources = [
            "daemon:profit", "daemon:scanner", "daemon:fill",
            "daemon:review", "daemon:watchpoint", "daemon:ml_conditions",
        ]
        for source in daemon_sources:
            provider = _make_provider_mock()
            mock_prov.return_value = (provider, MagicMock())
            ts = MagicMock()
            ts.autonomous_close_lockout = True
            mock_ts.return_value = ts
            trace_id, tracer = _mock_tracer(source)
            mock_gat.return_value = trace_id
            mock_gt.return_value = tracer

            result = handle_close_position(symbol="BTC", reasoning="test")
            assert "BLOCKED" in result, f"Source {source} was not blocked"

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_partial_close_also_blocked(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """6. Partial close (50%) is also blocked from daemon wakes."""
        from hynous.intelligence.tools.trading import handle_close_position
        provider = _make_provider_mock()
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = True
        mock_ts.return_value = ts
        trace_id, tracer = _mock_tracer("daemon:profit")
        mock_gat.return_value = trace_id
        mock_gt.return_value = tracer

        result = handle_close_position(symbol="BTC", reasoning="take partial", partial_pct=50)
        assert "BLOCKED" in result
        assert "autonomous" in result.lower()


# ---------------------------------------------------------------------------
# B. modify_position autonomous lockout (4 tests)
# ---------------------------------------------------------------------------

class TestModifyPositionAutonomousLockout:
    """Verify cancel_orders and TP modifications are blocked from daemon wakes."""

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_cancel_orders_blocked_from_daemon(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """7. cancel_orders from daemon → BLOCKED."""
        from hynous.intelligence.tools.trading import handle_modify_position
        provider = _make_provider_mock()
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = True
        mock_ts.return_value = ts
        trace_id, tracer = _mock_tracer("daemon:scanner")
        mock_gat.return_value = trace_id
        mock_gt.return_value = tracer

        result = handle_modify_position(symbol="BTC", reasoning="clear orders", cancel_orders=True)
        assert "BLOCKED" in result
        assert "cancel" in result.lower()

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_tp_modification_blocked_from_daemon(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """8. TP modification from daemon → BLOCKED."""
        from hynous.intelligence.tools.trading import handle_modify_position
        provider = _make_provider_mock()
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = True
        mock_ts.return_value = ts
        trace_id, tracer = _mock_tracer("daemon:profit")
        mock_gat.return_value = trace_id
        mock_gt.return_value = tracer

        result = handle_modify_position(symbol="BTC", reasoning="widen TP", take_profit=100000)
        assert "BLOCKED" in result
        assert "take profit" in result.lower()

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_sl_tightening_allowed_from_daemon(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """9. SL tightening from daemon → allowed (passes lockout gate)."""
        from hynous.intelligence.tools.trading import handle_modify_position
        provider = _make_provider_mock(position_side="long", mark_px=70000)
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = True
        mock_ts.return_value = ts
        trace_id, tracer = _mock_tracer("daemon:scanner")
        mock_gat.return_value = trace_id
        mock_gt.return_value = tracer

        result = handle_modify_position(symbol="BTC", reasoning="tighten SL", stop_loss=69500)
        # Should NOT be blocked by autonomous lockout — SL tightening is allowed
        assert "autonomous" not in result.lower() or "BLOCKED" not in result

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    @patch("hynous.core.request_tracer.get_active_trace")
    @patch("hynous.core.request_tracer.get_tracer")
    @patch("hynous.core.trading_settings.get_trading_settings")
    def test_cancel_orders_allowed_from_user(self, mock_ts, mock_gt, mock_gat, mock_prov):
        """10. cancel_orders from user chat → allowed."""
        from hynous.intelligence.tools.trading import handle_modify_position
        provider = _make_provider_mock()
        mock_prov.return_value = (provider, MagicMock())
        ts = MagicMock()
        ts.autonomous_close_lockout = True
        mock_ts.return_value = ts
        trace_id, tracer = _mock_tracer("user_chat")
        mock_gat.return_value = trace_id
        mock_gt.return_value = tracer

        result = handle_modify_position(symbol="BTC", reasoning="cancel all", cancel_orders=True)
        # Should not be blocked by autonomous lockout
        assert "autonomous" not in result.lower()


# ---------------------------------------------------------------------------
# C. TP widening guard (4 tests)
# ---------------------------------------------------------------------------

class TestTPWideningGuard:
    """Verify TP can only be tightened (moved closer to price), never widened."""

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    def test_tp_widen_blocked_long(self, mock_prov):
        """11. Long position: widening TP from 70k to 75k → BLOCKED."""
        from hynous.intelligence.tools.trading import handle_modify_position
        provider = _make_provider_mock(position_side="long", mark_px=68000)
        provider.get_trigger_orders.return_value = [
            {"order_type": "take_profit", "trigger_px": 70000, "oid": "tp1"},
        ]
        mock_prov.return_value = (provider, MagicMock())

        result = handle_modify_position(symbol="BTC", reasoning="widen TP", take_profit=75000)
        assert "BLOCKED" in result
        assert "Cannot widen" in result

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    def test_tp_tighten_allowed_long(self, mock_prov):
        """12. Long position: tightening TP from 70k to 69k → allowed."""
        from hynous.intelligence.tools.trading import handle_modify_position
        provider = _make_provider_mock(position_side="long", mark_px=68000)
        provider.get_trigger_orders.return_value = [
            {"order_type": "take_profit", "trigger_px": 70000, "oid": "tp1"},
        ]
        mock_prov.return_value = (provider, MagicMock())

        result = handle_modify_position(symbol="BTC", reasoning="tighten TP", take_profit=69000)
        assert "Cannot widen" not in result

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    def test_tp_widen_blocked_short(self, mock_prov):
        """13. Short position: widening TP from 60k to 55k → BLOCKED."""
        from hynous.intelligence.tools.trading import handle_modify_position
        provider = _make_provider_mock(position_side="short", mark_px=65000)
        provider.get_trigger_orders.return_value = [
            {"order_type": "take_profit", "trigger_px": 60000, "oid": "tp1"},
        ]
        mock_prov.return_value = (provider, MagicMock())

        result = handle_modify_position(symbol="BTC", reasoning="widen TP", take_profit=55000)
        assert "BLOCKED" in result
        assert "Cannot widen" in result

    @patch("hynous.intelligence.tools.trading._get_trading_provider")
    def test_tp_tighten_allowed_short(self, mock_prov):
        """14. Short position: tightening TP from 60k to 61k → allowed."""
        from hynous.intelligence.tools.trading import handle_modify_position
        provider = _make_provider_mock(position_side="short", mark_px=65000)
        provider.get_trigger_orders.return_value = [
            {"order_type": "take_profit", "trigger_px": 60000, "oid": "tp1"},
        ]
        mock_prov.return_value = (provider, MagicMock())

        result = handle_modify_position(symbol="BTC", reasoning="tighten TP", take_profit=61000)
        assert "Cannot widen" not in result


# ---------------------------------------------------------------------------
# D. Config flag (2 tests)
# ---------------------------------------------------------------------------

class TestConfigFlag:
    """Verify config flag exists and defaults correctly."""

    def test_config_flag_exists_in_trading_settings(self):
        """15. TradingSettings has autonomous_close_lockout defaulting to True."""
        src = _settings_source()
        assert "autonomous_close_lockout: bool = True" in src

    def test_config_flag_in_yaml(self):
        """16. default.yaml has autonomous_close_lockout: true."""
        cfg = _default_yaml()
        daemon_cfg = cfg.get("daemon", {})
        assert daemon_cfg.get("autonomous_close_lockout") is True


# ---------------------------------------------------------------------------
# E. Structural verification (bonus — no close language in messages)
# ---------------------------------------------------------------------------

class TestMessageLanguage:
    """Verify wake messages don't contain close-pressure language."""

    def test_no_close_in_profit_wakes(self):
        """Profit wake tiers should not contain close commands."""
        src = _daemon_source()
        # Find the _wake_for_profit method
        start = src.find("def _wake_for_profit(")
        end = src.find("\n    def ", start + 1)
        method = src[start:end] if end != -1 else src[start:]
        # Should not have aggressive close language
        assert "CLOSE THIS TRADE NOW" not in method
        assert "CLOSE NOW" not in method
        assert "close it and move on" not in method
        assert "Lock in the gain" not in method
        assert "Take what's left" not in method

    def test_no_close_in_scanner_footers(self):
        """Scanner footers should not contain close commands."""
        src = _scanner_source()
        assert "Close or tighten SL now" not in src
        assert "CLOSE or tighten SL" not in src
        assert "close and lock in what's left" not in src

    def test_position_block_footer_updated(self):
        """Position block in daemon should say 'Mechanical exits active'."""
        src = _daemon_source()
        assert "Mechanical exits active on all positions" in src
        assert "consider whether to close" not in src

    def test_system_prompt_full_exit_lockout(self):
        """System prompt should contain FULL EXIT LOCKOUT."""
        src = _builder_source()
        assert "FULL EXIT LOCKOUT" in src
        assert "I CANNOT close positions" in src
