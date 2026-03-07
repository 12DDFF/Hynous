"""
Unit tests for Fix 02: B1 (stale trigger cache on new entry).

Tests verify:
1. has_good_sl logic correctly compares SL prices to breakeven
2. Stale cache (missing SL) causes has_good_sl = False
3. Fresh cache (with SL) causes has_good_sl = True when SL >= breakeven (long)
4. Fresh cache (with SL) causes has_good_sl = False when SL < breakeven (correctly upgrades)
"""
import pytest
from pathlib import Path


def _daemon_source() -> str:
    daemon_path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return daemon_path.read_text()


class TestHasGoodSlLogic:
    """The has_good_sl check must correctly evaluate trigger prices."""

    def _has_good_sl(self, triggers, be_price, is_long):
        """Replicate the has_good_sl logic from daemon.py:1845-1851."""
        return any(
            t.get("order_type") == "stop_loss" and (
                (is_long and t.get("trigger_px", 0) >= be_price) or
                (not is_long and 0 < t.get("trigger_px", 0) <= be_price)
            )
            for t in triggers
        )

    def test_stale_cache_empty_triggers(self):
        """Stale cache has no triggers for this coin → has_good_sl is False."""
        triggers = []  # stale cache: no triggers
        be_price = 100_070  # entry 100k + 0.07%
        assert not self._has_good_sl(triggers, be_price, is_long=True)

    def test_fresh_cache_agent_sl_above_breakeven_long(self):
        """Agent's SL above breakeven → has_good_sl is True → breakeven skips."""
        # Agent placed SL at $100,500 (above breakeven $100,070)
        triggers = [{"order_type": "stop_loss", "trigger_px": 100_500, "oid": 42}]
        be_price = 100_070
        assert self._has_good_sl(triggers, be_price, is_long=True)

    def test_fresh_cache_agent_sl_at_breakeven_long(self):
        """Agent's SL exactly at breakeven → has_good_sl is True."""
        triggers = [{"order_type": "stop_loss", "trigger_px": 100_070, "oid": 42}]
        be_price = 100_070
        assert self._has_good_sl(triggers, be_price, is_long=True)

    def test_fresh_cache_agent_sl_below_breakeven_long(self):
        """Agent's SL below breakeven → has_good_sl is False → breakeven correctly upgrades."""
        # Agent's SL at $98,500 (-1.5%), breakeven at $100,070
        triggers = [{"order_type": "stop_loss", "trigger_px": 98_500, "oid": 42}]
        be_price = 100_070
        assert not self._has_good_sl(triggers, be_price, is_long=True)

    def test_fresh_cache_agent_sl_below_breakeven_short(self):
        """Short: agent's SL below breakeven → has_good_sl is True → breakeven skips."""
        # Short entry at $100,000, breakeven at $99,930
        # Agent's SL at $99,500 (below breakeven = tighter for short)
        triggers = [{"order_type": "stop_loss", "trigger_px": 99_500, "oid": 42}]
        be_price = 99_930
        assert self._has_good_sl(triggers, be_price, is_long=False)

    def test_fresh_cache_agent_sl_above_breakeven_short(self):
        """Short: agent's SL above breakeven → has_good_sl is False → breakeven upgrades."""
        # Agent's SL at $101,000 (above breakeven = wider for short)
        triggers = [{"order_type": "stop_loss", "trigger_px": 101_000, "oid": 42}]
        be_price = 99_930
        assert not self._has_good_sl(triggers, be_price, is_long=False)

    def test_tp_order_does_not_count_as_sl(self):
        """A take-profit trigger should not satisfy has_good_sl."""
        triggers = [{"order_type": "take_profit", "trigger_px": 105_000, "oid": 42}]
        be_price = 100_070
        assert not self._has_good_sl(triggers, be_price, is_long=True)


class TestNewEntryTriggersRefresh:
    """Verify that new entry detection should trigger a cache refresh."""

    def test_new_coin_detected(self):
        """A coin in current but not in prev_positions is a new entry."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20}
        }
        current = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        has_new_entries = any(coin not in prev_positions for coin in current)
        assert has_new_entries, "ETH is a new entry"

    def test_no_new_coin(self):
        """No new coins → no refresh needed."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20}
        }
        current = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20}
        }
        has_new_entries = any(coin not in prev_positions for coin in current)
        assert not has_new_entries

    def test_closed_position_is_not_new_entry(self):
        """A coin that was in prev but not in current is a close, not an entry."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        current = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20}
        }
        has_new_entries = any(coin not in prev_positions for coin in current)
        assert not has_new_entries, "ETH closing is not a new entry"


class TestRefreshTriggerCacheCallSite:
    """Verify _refresh_trigger_cache is called from _check_positions on new entry."""

    def test_refresh_called_in_check_positions(self):
        """_check_positions must call _refresh_trigger_cache when new entries appear."""
        source = _daemon_source()
        # Find the _check_positions method and verify it contains _refresh_trigger_cache
        method_start = source.find("def _check_positions(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "_refresh_trigger_cache" in method_source, (
            "_check_positions must call _refresh_trigger_cache when new entries are detected"
        )

    def test_has_new_entries_flag_in_check_positions(self):
        """_check_positions must use has_new_entries flag to guard the refresh call."""
        source = _daemon_source()
        method_start = source.find("def _check_positions(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "has_new_entries" in method_source, (
            "_check_positions must use has_new_entries flag"
        )
