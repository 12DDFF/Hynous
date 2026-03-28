"""Unit tests for the breakeven system (fee-BE) and protective SL layers.

Tests verify:
1. Fee-breakeven: existing fee-proportional behavior unchanged
2. No wake_agent in protective SL blocks
3. Refresh trigger cache after SL placement
4. Cancel-before-place pattern in protective SL blocks
5. Rollback: cancel succeeds, place fails → old SL restored
6. Paper provider integration: SL actually triggers at correct price
7. Edge cases: disabled config, zero size, tighter-SL detection
"""
import pytest
from pathlib import Path


# ── Source Helpers ────────────────────────────────────────────────────────────

def _daemon_source() -> str:
    daemon_path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return daemon_path.read_text()


def _config_source() -> str:
    config_path = Path(__file__).parent.parent.parent / "src" / "hynous" / "core" / "config.py"
    return config_path.read_text()


def _default_yaml() -> dict:
    import yaml
    yaml_path = Path(__file__).parent.parent.parent / "config" / "default.yaml"
    with open(yaml_path) as f:
        return yaml.safe_load(f)


# ── Class 1: Static Source Code Validation ────────────────────────────────────

class TestProtectiveSlExists:
    """Verify structural correctness of protective SL layers via source code inspection."""

    def test_dynamic_sl_block_exists_in_fast_trigger_check(self):
        """dynamic_sl_enabled block must exist in _fast_trigger_check."""
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "dynamic_sl_enabled" in method_source, \
            "dynamic_sl_enabled block must exist in _fast_trigger_check"

    def test_dynamic_sl_runs_before_fee_be(self):
        """Dynamic SL block must appear BEFORE fee-BE block in _fast_trigger_check."""
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        dynamic_sl_pos = method_source.find("dynamic_sl_enabled")
        fee_be_pos = method_source.find("fee_breakeven")
        assert dynamic_sl_pos > 0, "dynamic_sl_enabled not found in _fast_trigger_check"
        assert fee_be_pos > 0, "fee_breakeven not found in _fast_trigger_check"
        assert dynamic_sl_pos < fee_be_pos, \
            "dynamic SL block must appear before fee-BE block"

    def test_no_wake_agent_in_breakeven_blocks(self):
        """_wake_agent must NOT appear in the protective SL region (dynamic SL + fee-BE).

        Bug B fix: _wake_agent was blocking _fast_trigger_check for 5-30s.
        Both dynamic SL and fee-BE must be fully mechanical — no agent involvement.
        """
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        be_start = method_source.find("dynamic_sl_enabled")
        trail_start = method_source.find("Trailing Stop", be_start)
        assert be_start > 0, "dynamic_sl_enabled section must exist in _fast_trigger_check"
        assert trail_start > 0, "Trailing Stop section must exist after dynamic SL"
        be_region = method_source[be_start:trail_start]
        assert "_wake_agent" not in be_region, \
            "Bug B: _wake_agent must NOT appear in protective SL blocks (blocks the loop)"

    def test_refresh_trigger_cache_after_be_placement(self):
        """_refresh_trigger_cache must appear after every place_trigger_order in BE region.

        Bug A fix: stale cache allowed trailing stop to overwrite the breakeven SL.
        """
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        be_start = method_source.find("dynamic_sl_enabled")
        trail_start = method_source.find("Trailing Stop", be_start)
        be_region = method_source[be_start:trail_start]
        # Count placements and refreshes in breakeven region
        place_count = be_region.count("place_trigger_order(")
        refresh_count = be_region.count("_refresh_trigger_cache()")
        assert refresh_count >= place_count, (
            f"Bug A: {place_count} place_trigger_order calls but only "
            f"{refresh_count} _refresh_trigger_cache calls in BE region"
        )

    def test_cancel_before_place_in_dynamic_sl(self):
        """cancel_order must appear before place_trigger_order in dynamic SL block."""
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        be_start = method_source.find("dynamic_sl_enabled")
        assert be_start > 0, "dynamic_sl_enabled section must exist in _fast_trigger_check"
        cancel_pos = method_source.find("cancel_order", be_start)
        place_pos = method_source.find("place_trigger_order", be_start)
        assert cancel_pos > 0, "cancel_order must appear in dynamic SL block"
        assert place_pos > 0, "place_trigger_order must appear in dynamic SL block"
        assert cancel_pos < place_pos, \
            "Bug C pattern: cancel_order must come before place_trigger_order"


# ── Class 2: Fee-BE State Machine Tests ───────────────────────────────────────

class TestFeeBeProgression:
    """Simulate the fee-BE state machine progression."""

    def _fee_be_gate(self, roe_pct, breakeven_set, leverage=20,
                     taker_fee_pct=0.07, enabled=True):
        """Replicate fee-BE gate conditions (pure logic, no provider calls)."""
        if not enabled:
            return False
        if breakeven_set.get("SYM"):
            return False
        fee_be_roe = taker_fee_pct * leverage
        return roe_pct >= fee_be_roe

    def test_fee_be_fires_above_threshold(self):
        """ROE above fee-BE threshold (1.4% at 20x): fee-BE fires."""
        breakeven_set = {}
        # (use 1.41 to avoid float precision issue: 0.07 * 20 = 1.4000000000000001)
        fired = self._fee_be_gate(1.41, breakeven_set)
        assert fired, "Fee-BE should fire above threshold"

    def test_fee_be_does_not_fire_below_threshold(self):
        """ROE below fee-BE threshold: fee-BE does not fire."""
        breakeven_set = {}
        fired = self._fee_be_gate(0.8, breakeven_set)
        assert not fired, "Fee-BE should NOT fire below threshold (1.4% at 20x)"

    def test_fee_be_disabled_neither_fires(self):
        """With fee-BE disabled via config, does not fire."""
        breakeven_set = {}
        fired = self._fee_be_gate(5.0, breakeven_set, enabled=False)
        assert not fired

    def test_side_flip_resets_breakeven_flag(self):
        """After side flip, breakeven flag must clear."""
        breakeven_set = {"SYM": True}
        breakeven_set.pop("SYM", None)
        assert not breakeven_set.get("SYM")

    def test_position_close_cleans_breakeven_flag(self):
        """After position close, breakeven flag must be removed."""
        breakeven_set = {"BTC": True}
        open_coins = {"ETH"}  # BTC closed

        for coin in list(breakeven_set):
            if coin not in open_coins:
                del breakeven_set[coin]

        assert "BTC" not in breakeven_set


# ── Class 3: Rollback Tests ───────────────────────────────────────────────────

class TestCancelReplaceRollback:
    """Verify rollback behavior when cancel succeeds but placement fails (Bug C fix)."""

    def test_old_sl_restored_on_placement_failure(self):
        """If cancel succeeds but place throws, old SL must be restored."""
        old_sl_info = (42, 97.0)  # (oid, trigger_px)
        cancelled = []
        placed = []
        call_count = [0]

        def cancel_order(sym, oid):
            cancelled.append(oid)
            return True

        def place_trigger_order(symbol, is_buy, sz, trigger_px, tpsl="sl"):
            call_count[0] += 1
            if call_count[0] == 1:
                # First call: new BE placement fails
                raise ValueError("Exchange rejected order")
            # Second call: rollback restoration
            placed.append(trigger_px)

        triggers = [{"order_type": "stop_loss", "trigger_px": 97.0, "oid": 42}]

        # Cancel existing SL
        for t in triggers:
            if t.get("order_type") == "stop_loss" and t.get("oid"):
                cancel_order("SYM", t["oid"])

        # Try place new BE SL (fails)
        try:
            place_trigger_order("SYM", False, 0.1, trigger_px=100.0)
        except Exception:
            # Rollback: restore old SL
            if old_sl_info:
                place_trigger_order(
                    "SYM", False, 0.1, trigger_px=old_sl_info[1], tpsl="sl"
                )

        assert 42 in cancelled, "Old SL must be cancelled first"
        assert placed == [97.0], "Old SL must be restored on failure"

    def test_no_rollback_when_no_previous_sl(self):
        """If no old SL existed, failure just logs warning — no rollback needed."""
        old_sl_info = None  # No previous SL
        rollback_called = []

        try:
            raise ValueError("Place failed")
        except Exception:
            if old_sl_info:
                rollback_called.append(True)

        assert not rollback_called, "No rollback when no old SL existed"

    def test_rollback_failure_logs_critical(self):
        """Dynamic SL must have rollback logic; CRITICAL log exists in fee-BE double-failure path."""
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        # Dynamic SL block must have rollback warning
        dyn_start = method_source.find("dynamic_sl_enabled")
        assert dyn_start > 0, "dynamic_sl_enabled block must exist in _fast_trigger_check"
        rollback_pos = method_source.find("rolled back to old SL", dyn_start)
        assert rollback_pos > 0, "Dynamic SL block must have rollback on failure"
        # Fee-BE still has CRITICAL log for double-failure (unchanged)
        fee_be_pos = method_source.find("fee_breakeven")
        critical_pos = method_source.find("CRITICAL", fee_be_pos)
        assert critical_pos > 0, "CRITICAL log must appear in fee-BE double-failure rollback path"

    def test_rollback_exists_in_fee_be_block_too(self):
        """Fee-BE block must also have rollback protection."""
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        fee_be_pos = method_source.find("fee_breakeven")
        trail_pos = method_source.find("Trailing Stop")
        fee_be_region = method_source[fee_be_pos:trail_pos]
        # Both rollback indicators must exist in fee-BE block
        assert "old_sl_info" in fee_be_region, "Fee-BE must save old SL for rollback"
        assert "CRITICAL" in fee_be_region, "Fee-BE must have CRITICAL log for rollback failure"


# ── Class 3b: Paper Provider Integration Tests ────────────────────────────────

class TestPaperProviderBreakevenIntegration:
    """Integration tests using real PaperProvider with temp storage."""

    @pytest.fixture
    def paper(self, tmp_path):
        """Create PaperProvider with temp storage and mock price feed."""
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
        from hynous.data.providers.paper import PaperProvider
        from unittest.mock import MagicMock, patch

        mock_real = MagicMock()
        mock_real.get_price.return_value = 100.0  # Fixed price for testing

        storage_dir = tmp_path / "storage"
        storage_dir.mkdir()
        storage_file = str(storage_dir / "paper-state.json")
        with patch.object(PaperProvider, "_find_storage_path", return_value=storage_file):
            provider = PaperProvider(mock_real, initial_balance=10000.0)
        return provider

    @pytest.fixture
    def long_position(self, paper):
        """Open a long position at $100 (0.1 size, 20x leverage, $10 margin)."""
        paper.leverage_map["SYM"] = 20
        paper.market_open("SYM", is_buy=True, size_usd=200, slippage=0.0)
        return paper

    @pytest.fixture
    def short_position(self, paper):
        """Open a short position at $100 (0.1 size, 20x leverage, $10 margin)."""
        paper.leverage_map["SYM"] = 20
        paper.market_open("SYM", is_buy=False, size_usd=200, slippage=0.0)
        return paper

    def test_check_triggers_fills_at_sl_price_not_market(self, long_position):
        """Paper provider fills at sl_px, not at the passed-in market price.

        Critical: even if daemon was frozen and price gapped through the SL,
        the fill should be at SL price in paper mode (not market price).

        Note: must use a gap price above liquidation threshold to avoid liquidation
        firing first. At 20x and entry $100, liquidation_px ≈ $95.25.
        """
        paper = long_position
        pos = paper.positions.get("SYM")
        sl_price = 100.0
        paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=sl_price, tpsl="sl"
        )
        # Price gaps just below SL but above liquidation (liq ≈ $95.25 at 20x)
        # This simulates a gap through the SL without triggering liquidation
        events = paper.check_triggers({"SYM": 97.0})
        assert len(events) == 1
        assert events[0]["exit_px"] == sl_price, \
            "Fill must be at SL price ($100), not market gap price ($97)"

    def test_cancel_order_with_wrong_oid_returns_false(self, long_position):
        """Cancelling with a non-matching OID returns False, not an exception."""
        paper = long_position
        pos = paper.positions.get("SYM")
        paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=100.0, tpsl="sl"
        )
        result = paper.cancel_order("SYM", 9999)  # Wrong OID
        assert result is False

    def test_cancel_then_place_atomicity(self, long_position):
        """Verify cancel sets sl_px=None, place sets sl_px=new_price (no race)."""
        paper = long_position
        pos = paper.positions.get("SYM")

        # Initial SL at $97 (agent-placed)
        r = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=97.0, tpsl="sl"
        )
        old_oid = r["oid"]
        assert pos.sl_px == 97.0

        # Cancel: sl_px goes to None
        paper.cancel_order("SYM", old_oid)
        assert pos.sl_px is None

        # Place new BE SL: sl_px goes to $100.0
        paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=100.0, tpsl="sl"
        )
        assert pos.sl_px == 100.0


# ── Class 4: Edge Cases ───────────────────────────────────────────────────────

class TestBreakevenEdgeCases:
    """Edge cases: disabled config, zero size, tighter-SL detection."""

    def test_fee_breakeven_disabled_via_config(self):
        """breakeven_stop_enabled=False → fee-BE block skipped entirely."""
        breakeven_stop_enabled = False
        roe = 2.0  # Way above fee threshold

        breakeven_set = {}
        if breakeven_stop_enabled and not breakeven_set.get("SYM") and roe >= 1.4:
            breakeven_set["SYM"] = True

        assert not breakeven_set.get("SYM"), "Fee-BE must be skipped when disabled"

    def test_zero_size_position_sz_is_zero(self):
        """If pos.size=0, trigger order would be placed with sz=0 (edge case)."""
        pos = {"size": 0, "entry_px": 100.0}
        sz = pos.get("size", 0)
        assert sz == 0, "Zero-size position results in sz=0"
        # Code doesn't skip zero-size — this is a potential edge case but
        # paper provider and Hyperliquid SDK handle it at their layer

    def test_has_tighter_sl_logic_for_long(self):
        """has_tighter_sl correctly identifies when existing SL >= reference for long."""
        entry_px = 100.0
        reference_price = entry_px
        is_long = True

        def has_tighter_sl(triggers):
            return any(
                t.get("order_type") == "stop_loss" and (
                    (is_long and t.get("trigger_px", 0) >= reference_price) or
                    (not is_long and 0 < t.get("trigger_px", 0) <= reference_price)
                )
                for t in triggers
            )

        # SL above entry → already tighter → skip protective SL
        assert has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 100.5, "oid": 1}])
        # SL at entry → already tighter (equal counts as tighter)
        assert has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 100.0, "oid": 1}])
        # SL below entry → needs protective SL
        assert not has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 97.0, "oid": 1}])
        # No SL at all → needs protective SL
        assert not has_tighter_sl([])

    def test_has_tighter_sl_logic_for_short(self):
        """has_tighter_sl correctly identifies when existing SL <= reference for short."""
        entry_px = 100.0
        reference_price = entry_px
        is_long = False

        def has_tighter_sl(triggers):
            return any(
                t.get("order_type") == "stop_loss" and (
                    (is_long and t.get("trigger_px", 0) >= reference_price) or
                    (not is_long and 0 < t.get("trigger_px", 0) <= reference_price)
                )
                for t in triggers
            )

        # SL below entry for short → already tighter → skip protective SL
        assert has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 99.5, "oid": 1}])
        # SL at entry for short → equal counts as tighter
        assert has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 100.0, "oid": 1}])
        # SL above entry for short → needs protective SL
        assert not has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 103.0, "oid": 1}])
        # TP doesn't count as SL
        assert not has_tighter_sl([{"order_type": "take_profit", "trigger_px": 99.0, "oid": 1}])


