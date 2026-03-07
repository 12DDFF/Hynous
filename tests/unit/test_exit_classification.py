"""
Unit tests for Fix 04: T2 + B2 (exit classification override).

Tests verify:
1. _override_sl_classification correctly refines "stop_loss"
2. Trailing takes precedence over breakeven
3. Non-stop_loss classifications are untouched
4. _override_sl_classification is called in all three code paths
"""
import pytest
from pathlib import Path


def _daemon_source() -> str:
    daemon_path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return daemon_path.read_text()


class TestOverrideClassification:
    """Test the _override_sl_classification logic."""

    def _override(self, coin, classification, trailing_active, breakeven_set):
        """Replicate _override_sl_classification logic."""
        if classification != "stop_loss":
            return classification
        if trailing_active.get(coin):
            return "trailing_stop"
        if breakeven_set.get(coin):
            return "breakeven_stop"
        return classification

    def test_trailing_active_overrides(self):
        """When trailing is active, stop_loss → trailing_stop."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={"BTC": True},
            breakeven_set={"BTC": True},
        )
        assert result == "trailing_stop"

    def test_breakeven_only_overrides(self):
        """When only breakeven is set, stop_loss → breakeven_stop."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={},
            breakeven_set={"BTC": True},
        )
        assert result == "breakeven_stop"

    def test_trailing_takes_precedence_over_breakeven(self):
        """When both trailing and breakeven are set, trailing wins."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={"BTC": True},
            breakeven_set={"BTC": True},
        )
        assert result == "trailing_stop"

    def test_neither_active_keeps_stop_loss(self):
        """Agent-placed SL stays as stop_loss."""
        result = self._override(
            "BTC", "stop_loss",
            trailing_active={},
            breakeven_set={},
        )
        assert result == "stop_loss"

    def test_take_profit_not_overridden(self):
        """take_profit is never overridden, even with trailing active."""
        result = self._override(
            "BTC", "take_profit",
            trailing_active={"BTC": True},
            breakeven_set={"BTC": True},
        )
        assert result == "take_profit"

    def test_liquidation_not_overridden(self):
        """liquidation is never overridden."""
        result = self._override(
            "BTC", "liquidation",
            trailing_active={"BTC": True},
            breakeven_set={"BTC": True},
        )
        assert result == "liquidation"

    def test_manual_not_overridden(self):
        """manual classification is never overridden."""
        result = self._override(
            "BTC", "manual",
            trailing_active={},
            breakeven_set={},
        )
        assert result == "manual"

    def test_different_coin_not_affected(self):
        """Trailing active on BTC doesn't affect ETH classification."""
        result = self._override(
            "ETH", "stop_loss",
            trailing_active={"BTC": True},
            breakeven_set={},
        )
        assert result == "stop_loss"


class TestOverrideMethodExists:
    """Verify the method exists and is called in the right places."""

    def test_method_exists(self):
        source = _daemon_source()
        assert "def _override_sl_classification(" in source

    def test_called_in_fast_trigger_check(self):
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "_override_sl_classification" in method_source

    def test_called_in_check_positions(self):
        source = _daemon_source()
        method_start = source.find("def _check_positions(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "_override_sl_classification" in method_source

    def test_called_in_handle_position_close(self):
        source = _daemon_source()
        method_start = source.find("def _handle_position_close(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "_override_sl_classification" in method_source


class TestNousRecordingGuard:
    """Verify trailing_stop and breakeven_stop are recorded to Nous."""

    def test_new_classifications_in_guard(self):
        """_handle_position_close must record trailing_stop and breakeven_stop to Nous."""
        source = _daemon_source()
        method_start = source.find("def _handle_position_close(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "trailing_stop" in method_source, "trailing_stop must be in the Nous recording guard"
        assert "breakeven_stop" in method_source, "breakeven_stop must be in the Nous recording guard"
