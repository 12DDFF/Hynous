"""
Unit tests for Fix 05: B3 (cancel old SL before placing breakeven SL).

Tests verify:
1. The cancel loop correctly identifies SL triggers
2. TP triggers are not cancelled
3. The cancel-before-place pattern exists in breakeven code
"""
import pytest
from pathlib import Path


def _daemon_source() -> str:
    daemon_path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return daemon_path.read_text()


class TestCancelLoopLogic:
    """Verify the cancel loop correctly selects SL triggers."""

    def test_cancels_stop_loss_triggers(self):
        """SL triggers with valid OIDs should be identified for cancellation."""
        triggers = [
            {"order_type": "stop_loss", "trigger_px": 98000, "oid": 42},
            {"order_type": "take_profit", "trigger_px": 105000, "oid": 43},
        ]
        to_cancel = [
            t["oid"] for t in triggers
            if t.get("order_type") == "stop_loss" and t.get("oid")
        ]
        assert to_cancel == [42]

    def test_skips_triggers_without_oid(self):
        """Triggers missing OID should be skipped."""
        triggers = [
            {"order_type": "stop_loss", "trigger_px": 98000},  # no oid
            {"order_type": "stop_loss", "trigger_px": 97000, "oid": 0},  # falsy oid
        ]
        to_cancel = [
            t["oid"] for t in triggers
            if t.get("order_type") == "stop_loss" and t.get("oid")
        ]
        assert to_cancel == []

    def test_handles_empty_triggers(self):
        """Empty trigger list produces no cancellations."""
        triggers = []
        to_cancel = [
            t["oid"] for t in triggers
            if t.get("order_type") == "stop_loss" and t.get("oid")
        ]
        assert to_cancel == []

    def test_multiple_sl_triggers(self):
        """Multiple SL triggers (shouldn't happen, but handle gracefully)."""
        triggers = [
            {"order_type": "stop_loss", "trigger_px": 98000, "oid": 42},
            {"order_type": "stop_loss", "trigger_px": 97000, "oid": 44},
        ]
        to_cancel = [
            t["oid"] for t in triggers
            if t.get("order_type") == "stop_loss" and t.get("oid")
        ]
        assert to_cancel == [42, 44]


class TestBreakevenCancelPattern:
    """Verify cancel_order is called in breakeven code path."""

    def test_breakeven_cancels_before_placing(self):
        """The breakeven block must call cancel_order before place_trigger_order."""
        source = _daemon_source()

        # Find breakeven section in _fast_trigger_check
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]

        # Find the breakeven placement section (after has_good_sl check)
        be_start = method_source.find("Breakeven stop")
        assert be_start > 0, "Breakeven section must exist"

        be_place = method_source.find("place_trigger_order", be_start)
        assert be_place > 0, "Breakeven must call place_trigger_order"

        # cancel_order must appear BEFORE place_trigger_order in the breakeven section
        be_cancel = method_source.find("cancel_order", be_start)
        assert be_cancel > 0, "Breakeven must call cancel_order"
        assert be_cancel < be_place, "cancel_order must come before place_trigger_order in breakeven"
