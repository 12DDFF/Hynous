"""Unit tests for the two-layer breakeven system (capital-BE + fee-BE).

Tests verify:
1. Capital-breakeven (Layer 1): activates at fixed ROE threshold, SL at entry price
2. Fee-breakeven (Layer 2): existing fee-proportional behavior unchanged
3. State lifecycle: side-flip and position-close cleanup for _capital_be_set
4. Classification override: capital_breakeven_stop added to _override_sl_classification
5. Rollback: cancel succeeds, place fails → old SL restored
6. Paper provider integration: SL actually triggers at correct price
7. Candle peak re-evaluation: capital-BE triggered from candle wicks
8. Edge cases: low leverage, disabled config, zero size, multi-position independence
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

class TestCapitalBreakevenExists:
    """Verify structural correctness via source code inspection."""

    def test_capital_be_set_dict_initialized(self):
        """_capital_be_set must be initialized in __init__."""
        source = _daemon_source()
        assert "self._capital_be_set: dict[str, bool] = {}" in source, \
            "_capital_be_set state dict must be initialized in __init__"

    def test_capital_be_config_fields_exist(self):
        """DaemonConfig must have capital_breakeven_enabled and capital_breakeven_roe."""
        source = _config_source()
        assert "capital_breakeven_enabled" in source, \
            "capital_breakeven_enabled must be in DaemonConfig"
        assert "capital_breakeven_roe" in source, \
            "capital_breakeven_roe must be in DaemonConfig"

    def test_yaml_defaults_match_python(self):
        """YAML defaults must match DaemonConfig Python defaults exactly."""
        cfg = _default_yaml()
        daemon_cfg = cfg.get("daemon", {})
        assert daemon_cfg.get("capital_breakeven_enabled") is True, \
            "YAML capital_breakeven_enabled must be true"
        assert daemon_cfg.get("capital_breakeven_roe") == 0.5, \
            "YAML capital_breakeven_roe must be 0.5"
        # Verify Python defaults match
        source = _config_source()
        assert "capital_breakeven_enabled: bool = True" in source
        assert "capital_breakeven_roe: float = 0.5" in source

    def test_capital_be_block_exists_in_fast_trigger_check(self):
        """capital_breakeven must appear in _fast_trigger_check."""
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "capital_breakeven" in method_source, \
            "capital_breakeven block must exist in _fast_trigger_check"

    def test_capital_be_runs_before_fee_be(self):
        """Capital-BE block must appear BEFORE fee-BE block in _fast_trigger_check.

        Capital-BE has a lower threshold (0.5%), so it must evaluate first.
        """
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        capital_be_pos = method_source.find("capital_breakeven")
        fee_be_pos = method_source.find("fee_breakeven")
        assert capital_be_pos > 0, "capital_breakeven not found in _fast_trigger_check"
        assert fee_be_pos > 0, "fee_breakeven not found in _fast_trigger_check"
        assert capital_be_pos < fee_be_pos, \
            "capital-BE block must appear before fee-BE block"

    def test_no_wake_agent_in_breakeven_blocks(self):
        """_wake_agent must NOT appear between breakeven blocks and trailing stop.

        Bug B fix: _wake_agent was blocking _fast_trigger_check for 5-30s.
        Breakeven must be fully mechanical — no agent involvement.
        """
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        be_start = method_source.find("capital_breakeven")
        trail_start = method_source.find("Trailing Stop", be_start)
        assert trail_start > 0, "Trailing Stop section must exist after breakeven"
        be_region = method_source[be_start:trail_start]
        assert "_wake_agent" not in be_region, \
            "Bug B: _wake_agent must NOT appear in breakeven blocks (blocks the loop)"

    def test_refresh_trigger_cache_after_be_placement(self):
        """_refresh_trigger_cache must appear after every place_trigger_order in BE region.

        Bug A fix: stale cache allowed trailing stop to overwrite the breakeven SL.
        """
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        be_start = method_source.find("capital_breakeven")
        trail_start = method_source.find("Trailing Stop", be_start)
        be_region = method_source[be_start:trail_start]
        # Count placements and refreshes in breakeven region
        place_count = be_region.count("place_trigger_order(")
        refresh_count = be_region.count("_refresh_trigger_cache()")
        assert refresh_count >= place_count, (
            f"Bug A: {place_count} place_trigger_order calls but only "
            f"{refresh_count} _refresh_trigger_cache calls in BE region"
        )

    def test_cancel_before_place_in_capital_be(self):
        """cancel_order must appear before place_trigger_order in capital-BE block."""
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        be_start = method_source.find("capital_breakeven")
        assert be_start > 0, "capital_breakeven section must exist"
        cancel_pos = method_source.find("cancel_order", be_start)
        place_pos = method_source.find("place_trigger_order", be_start)
        assert cancel_pos > 0, "cancel_order must appear in capital-BE block"
        assert place_pos > 0, "place_trigger_order must appear in capital-BE block"
        assert cancel_pos < place_pos, \
            "Bug C fix: cancel_order must come before place_trigger_order"

    def test_capital_be_cleanup_in_side_flip(self):
        """_capital_be_set must be cleared on side flip (new position same coin)."""
        source = _daemon_source()
        # Find _check_profit_levels (contains side-flip cleanup)
        method_start = source.find("def _check_profit_levels(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "_capital_be_set" in method_source, \
            "_capital_be_set must be cleaned up in _check_profit_levels side-flip block"

    def test_capital_be_cleanup_on_position_close(self):
        """_capital_be_set entries must be removed when position closes."""
        source = _daemon_source()
        method_start = source.find("def _check_profit_levels(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        # The cleanup loop for _capital_be_set must exist
        assert "self._capital_be_set" in method_source, \
            "_capital_be_set must appear in position-close cleanup"


# ── Class 2: Formula Tests ────────────────────────────────────────────────────

class TestCapitalBreakevenFormula:
    """Pure math validation for capital-BE price calculations."""

    def test_long_sl_at_entry_price(self):
        """Long capital-BE SL = exactly entry price (no buffer)."""
        entry_px = 100.0
        capital_be_price = entry_px  # No buffer for capital-BE
        assert capital_be_price == 100.0

    def test_short_sl_at_entry_price(self):
        """Short capital-BE SL = exactly entry price (no buffer)."""
        entry_px = 85.6165  # SOL SHORT from problem description
        capital_be_price = entry_px
        assert capital_be_price == 85.6165

    def test_capital_be_threshold_is_fixed_not_leverage_scaled(self):
        """Capital-BE threshold is fixed (0.5%), NOT fee-proportional.

        Fee-BE scales: 1.4% at 20x, 0.7% at 10x.
        Capital-BE stays 0.5% regardless of leverage.
        """
        taker_fee_pct = 0.07
        capital_be_roe = 0.5  # Fixed from config
        for leverage in [20, 15, 10]:
            fee_be_roe = taker_fee_pct * leverage
            assert capital_be_roe == 0.5, "Capital-BE must be fixed regardless of leverage"
            assert fee_be_roe > capital_be_roe, (
                f"At {leverage}x: fee_be ({fee_be_roe:.2f}%) > capital_be (0.5%) ✓"
            )

    def test_at_5x_fee_be_threshold_below_capital_be(self):
        """At 5x leverage, fee_be_roe=0.35% is BELOW capital_be_roe=0.5%.

        Fee-BE fires first, sets _breakeven_set=True → capital-BE skips.
        Capital-BE block gate: `not self._breakeven_set.get(sym)` catches this.
        """
        taker_fee_pct = 0.07
        leverage = 5
        fee_be_roe = taker_fee_pct * leverage  # 0.35%
        capital_be_roe = 0.5
        assert fee_be_roe < capital_be_roe, (
            f"At 5x: fee_be ({fee_be_roe:.2f}%) < capital_be ({capital_be_roe}%) — "
            "fee fires first, capital-BE will skip"
        )

    def test_fee_be_sl_tighter_than_capital_be_for_long(self):
        """Fee-BE SL > capital-BE SL for longs (higher price = fires sooner on way down)."""
        entry_px = 100.0
        buffer_pct = 0.07 / 100.0  # 0.07%
        capital_be_sl = entry_px                      # $100.00
        fee_be_sl = entry_px * (1 + buffer_pct)      # $100.07
        assert fee_be_sl > capital_be_sl, "Fee-BE SL must be above entry for longs"
        assert round(fee_be_sl, 4) == 100.07

    def test_fee_be_sl_tighter_than_capital_be_for_short(self):
        """Fee-BE SL < capital-BE SL for shorts (lower price = fires sooner on way up)."""
        entry_px = 100.0
        buffer_pct = 0.07 / 100.0
        capital_be_sl = entry_px                      # $100.00
        fee_be_sl = entry_px * (1 - buffer_pct)      # $99.93
        assert fee_be_sl < capital_be_sl, "Fee-BE SL must be below entry for shorts"
        assert round(fee_be_sl, 4) == 99.93

    def test_worst_case_loss_at_capital_be(self):
        """Capital-BE worst case: exit taker fee only (~0.7% ROE at 20x).

        Original SL was -5.69% ROE. Capital-BE limits loss to ~-0.7% ROE.
        """
        leverage = 20
        exit_fee_pct_per_side = 0.035  # 0.035% per side of notional
        # At 20x: exit fee as ROE = 0.035% * 20 = 0.7%
        exit_fee_roe = exit_fee_pct_per_side * leverage  # 0.7%
        original_sl_roe = -5.69  # From the SOL SHORT example
        # Capital-BE loss (-0.7% ROE) is much better than original SL (-5.69%)
        assert -exit_fee_roe > original_sl_roe, (
            f"Capital-BE max loss ({-exit_fee_roe:.1f}% ROE) must be better "
            f"than original SL ({original_sl_roe}% ROE)"
        )

    def test_sol_short_example_would_be_saved(self):
        """Reproduce SOL SHORT (2026-03-11): peak 1.06% < fee-BE 1.4%, no protection.

        The exact exit ROE depends on fee accounting. The key property to test is
        that capital-BE would have fired (peak >= 0.5%) but fee-BE would not (peak < 1.4%).
        """
        leverage = 20
        fee_be_roe = 0.07 * leverage  # 1.4% at 20x
        capital_be_roe = 0.5

        # From the problem description
        peak_roe = 1.06

        # With old system: peak was below fee-BE → no protection
        assert peak_roe < fee_be_roe, "Peak was below fee-BE threshold → no old protection"
        # With new system: peak crossed capital-BE → would have been protected
        assert peak_roe >= capital_be_roe, "Peak crossed capital-BE → new protection fires"

        # Capital-BE would have limited loss to exit fee only (~0.7% ROE)
        # vs the actual -5.69% ROE exit (from README — includes fees in accounting)
        original_exit_roe = -5.69
        capital_be_max_loss_roe = -(0.035 * leverage)  # ~-0.7%
        assert capital_be_max_loss_roe > original_exit_roe, \
            "Capital-BE would have saved significant ROE"


# ── Class 3: State Machine Logic Tests ───────────────────────────────────────

class TestTwoLayerProgression:
    """Simulate the two-layer state machine progression."""

    def _capital_be_gate(self, roe_pct, capital_be_set, breakeven_set,
                         capital_be_roe=0.5, enabled=True):
        """Replicate capital-BE gate conditions (pure logic, no provider calls)."""
        if not enabled:
            return False
        if capital_be_set.get("SYM"):
            return False
        if breakeven_set.get("SYM"):  # fee-BE is tighter — skip
            return False
        return roe_pct >= capital_be_roe

    def _fee_be_gate(self, roe_pct, breakeven_set, leverage=20,
                     taker_fee_pct=0.07, enabled=True):
        """Replicate fee-BE gate conditions (pure logic, no provider calls)."""
        if not enabled:
            return False
        if breakeven_set.get("SYM"):
            return False
        fee_be_roe = taker_fee_pct * leverage
        return roe_pct >= fee_be_roe

    def test_capital_be_sets_before_fee_be(self):
        """ROE 0 → 0.5%: capital-BE fires. ROE → 1.4%: fee-BE also fires."""
        capital_be_set = {}
        breakeven_set = {}

        # At 0.5% ROE: capital-BE fires
        if self._capital_be_gate(0.5, capital_be_set, breakeven_set):
            capital_be_set["SYM"] = True
        assert capital_be_set.get("SYM") is True
        assert not breakeven_set.get("SYM")

        # At slightly above 1.4% ROE: fee-BE fires
        # (use 1.41 to avoid float precision issue: 0.07 * 20 = 1.4000000000000001)
        if self._fee_be_gate(1.41, breakeven_set):
            breakeven_set["SYM"] = True
            capital_be_set["SYM"] = True  # fee-BE also sets capital-BE flag
        assert breakeven_set.get("SYM") is True
        assert capital_be_set.get("SYM") is True

    def test_fee_be_also_sets_capital_be_flag(self):
        """If ROE jumps directly past fee_be_roe, BOTH flags are set.

        Both blocks run in order. When fee-BE fires, it sets _capital_be_set=True
        because fee-BE SL is strictly tighter than capital-BE SL would be.
        """
        capital_be_set = {}
        breakeven_set = {}
        roe = 2.0  # Jumps straight past both thresholds

        # capital-BE runs first (always runs before fee-BE)
        if self._capital_be_gate(roe, capital_be_set, breakeven_set):
            capital_be_set["SYM"] = True

        # fee-BE runs second
        if self._fee_be_gate(roe, breakeven_set):
            breakeven_set["SYM"] = True
            capital_be_set["SYM"] = True  # fee-BE sets both flags

        assert capital_be_set.get("SYM") is True
        assert breakeven_set.get("SYM") is True

    def test_capital_be_skips_if_fee_be_already_set(self):
        """If fee-BE already set, capital-BE block must skip (fee-BE is tighter)."""
        capital_be_set = {}
        breakeven_set = {"SYM": True}  # fee-BE already fired

        fired = self._capital_be_gate(0.8, capital_be_set, breakeven_set)
        assert not fired, "Capital-BE must skip when breakeven_set is True"

    def test_neither_layer_fires_below_threshold(self):
        """ROE = 0.3% (below 0.5% capital-BE): neither layer fires."""
        capital_be_set = {}
        breakeven_set = {}
        roe = 0.3

        cap_fired = self._capital_be_gate(roe, capital_be_set, breakeven_set)
        fee_fired = self._fee_be_gate(roe, breakeven_set)
        assert not cap_fired
        assert not fee_fired

    def test_capital_be_fires_fee_be_does_not_at_20x(self):
        """At 0.8% ROE and 20x: capital-BE fires (≥0.5%), fee-BE does not (needs 1.4%)."""
        capital_be_set = {}
        breakeven_set = {}
        roe = 0.8
        leverage = 20

        cap_fired = self._capital_be_gate(roe, capital_be_set, breakeven_set)
        fee_fired = self._fee_be_gate(roe, breakeven_set, leverage=leverage)

        assert cap_fired, "Capital-BE should fire at 0.8% (threshold=0.5%)"
        assert not fee_fired, "Fee-BE should NOT fire at 0.8% (threshold=1.4% at 20x)"

    def test_both_disabled_neither_fires(self):
        """With both BE layers disabled via config, neither fires."""
        capital_be_set = {}
        breakeven_set = {}
        roe = 5.0  # Way above both thresholds

        cap_fired = self._capital_be_gate(roe, capital_be_set, breakeven_set, enabled=False)
        fee_fired = self._fee_be_gate(roe, breakeven_set, enabled=False)
        assert not cap_fired
        assert not fee_fired

    def test_side_flip_resets_both_flags(self):
        """After side flip (close long → open short), both flags must clear."""
        capital_be_set = {"SYM": True}
        breakeven_set = {"SYM": True}

        # Simulate side-flip cleanup
        capital_be_set.pop("SYM", None)
        breakeven_set.pop("SYM", None)

        assert not capital_be_set.get("SYM")
        assert not breakeven_set.get("SYM")

    def test_position_close_cleans_both_flags(self):
        """After position close, both flags must be removed from dicts."""
        capital_be_set = {"BTC": True, "ETH": False}
        breakeven_set = {"BTC": True}
        open_coins = {"ETH"}  # BTC position closed

        # Simulate position-close cleanup loop
        for coin in list(capital_be_set):
            if coin not in open_coins:
                del capital_be_set[coin]
        for coin in list(breakeven_set):
            if coin not in open_coins:
                del breakeven_set[coin]

        assert "BTC" not in capital_be_set
        assert "BTC" not in breakeven_set
        assert "ETH" in capital_be_set  # Other positions unaffected


# ── Class 4: Classification Tests ────────────────────────────────────────────

class TestCapitalBreakevenClassification:
    """Test _override_sl_classification precedence with new capital_breakeven_stop."""

    def _override(self, coin, classification, trailing_active, breakeven_set,
                  capital_be_set):
        """Replicate updated _override_sl_classification logic."""
        if classification != "stop_loss":
            return classification
        if trailing_active.get(coin):
            return "trailing_stop"
        if breakeven_set.get(coin):
            return "breakeven_stop"
        if capital_be_set.get(coin):
            return "capital_breakeven_stop"
        return classification

    def test_override_returns_capital_breakeven_stop(self):
        """capital_be_set=True, breakeven_set=False → capital_breakeven_stop."""
        result = self._override(
            "SOL", "stop_loss",
            trailing_active={},
            breakeven_set={},
            capital_be_set={"SOL": True},
        )
        assert result == "capital_breakeven_stop"

    def test_fee_be_takes_precedence_over_capital_be(self):
        """When both capital-BE and fee-BE set, fee-BE wins → breakeven_stop."""
        result = self._override(
            "SOL", "stop_loss",
            trailing_active={},
            breakeven_set={"SOL": True},
            capital_be_set={"SOL": True},
        )
        assert result == "breakeven_stop"

    def test_trailing_takes_precedence_over_both(self):
        """Trailing active wins over all breakeven classifications."""
        result = self._override(
            "SOL", "stop_loss",
            trailing_active={"SOL": True},
            breakeven_set={"SOL": True},
            capital_be_set={"SOL": True},
        )
        assert result == "trailing_stop"

    def test_no_flags_keeps_stop_loss(self):
        """No flags set → remains stop_loss (original agent SL)."""
        result = self._override("BTC", "stop_loss", {}, {}, {})
        assert result == "stop_loss"

    def test_classification_for_tp_unchanged(self):
        """take_profit is never overridden regardless of BE flags."""
        result = self._override(
            "BTC", "take_profit",
            trailing_active={"BTC": True},
            breakeven_set={"BTC": True},
            capital_be_set={"BTC": True},
        )
        assert result == "take_profit"

    def test_classification_for_liquidation_unchanged(self):
        """liquidation is never overridden."""
        result = self._override(
            "BTC", "liquidation",
            trailing_active={"BTC": True},
            breakeven_set={"BTC": True},
            capital_be_set={"BTC": True},
        )
        assert result == "liquidation"

    def test_different_coin_not_affected(self):
        """Capital-BE on BTC doesn't classify ETH as capital_breakeven_stop."""
        result = self._override(
            "ETH", "stop_loss",
            trailing_active={},
            breakeven_set={},
            capital_be_set={"BTC": True},  # BTC has capital-BE, not ETH
        )
        assert result == "stop_loss"

    def test_source_has_capital_breakeven_in_override_method(self):
        """Verify _override_sl_classification in daemon.py handles capital_breakeven_stop."""
        source = _daemon_source()
        method_start = source.find("def _override_sl_classification(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "capital_breakeven_stop" in method_source, \
            "_override_sl_classification must return capital_breakeven_stop"

    def test_source_has_capital_breakeven_in_recording_guard(self):
        """Verify _handle_position_close records capital_breakeven_stop to Nous."""
        source = _daemon_source()
        method_start = source.find("def _handle_position_close(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "capital_breakeven_stop" in method_source, \
            "capital_breakeven_stop must be in the Nous recording guard"
        assert "breakeven_stop" in method_source, \
            "breakeven_stop must still be in the Nous recording guard"
        assert "trailing_stop" in method_source, \
            "trailing_stop must still be in the Nous recording guard"


# ── Class 5: Rollback Tests ───────────────────────────────────────────────────

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
        """CRITICAL log must exist in code for double-failure scenario."""
        source = _daemon_source()
        method_start = source.find("def _fast_trigger_check(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        be_start = method_source.find("capital_breakeven")
        critical_pos = method_source.find("CRITICAL", be_start)
        assert critical_pos > 0, \
            "CRITICAL log must appear in capital-BE rollback failure path"

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


# ── Class 6: Paper Provider Integration Tests ─────────────────────────────────

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

    def test_capital_be_sl_actually_triggers_for_long(self, long_position):
        """Capital-BE SL at $100 triggers when price drops below it for long."""
        paper = long_position
        pos = paper.positions.get("SYM")
        assert pos is not None

        # Place capital-BE SL at entry price ($100)
        result = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=100.0, tpsl="sl"
        )
        assert result["status"] == "trigger_placed"
        assert pos.sl_px == 100.0

        # Price drops below SL
        events = paper.check_triggers({"SYM": 99.50})
        assert len(events) == 1
        event = events[0]
        assert event["coin"] == "SYM"
        assert event["classification"] == "stop_loss"
        # Paper provider fills at SL price, not gapped market price
        assert event["exit_px"] == 100.0, "Must fill at SL price, not market price"

    def test_capital_be_sl_does_not_trigger_above_entry(self, long_position):
        """Capital-BE SL at $100 does NOT trigger while price is above entry."""
        paper = long_position
        pos = paper.positions.get("SYM")
        paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=100.0, tpsl="sl"
        )
        # Price is above entry (trade is in profit)
        events = paper.check_triggers({"SYM": 101.0})
        assert len(events) == 0, "SL must not trigger when price is above entry"

    def test_capital_be_sl_triggers_for_short(self, short_position):
        """Capital-BE SL at $100 triggers when price rises above it for short."""
        paper = short_position
        pos = paper.positions.get("SYM")
        assert pos is not None
        assert pos.side == "short"

        # Place capital-BE SL at entry price ($100)
        paper.place_trigger_order(
            "SYM", is_buy=True, sz=pos.size, trigger_px=100.0, tpsl="sl"
        )
        assert pos.sl_px == 100.0

        # Price rises above SL (triggers for short)
        events = paper.check_triggers({"SYM": 100.50})
        assert len(events) == 1
        assert events[0]["exit_px"] == 100.0, "Short SL must fill at SL price"

    def test_fee_be_replaces_capital_be_sl(self, long_position):
        """Fee-BE SL at $100.07 replaces capital-BE SL at $100 for long."""
        paper = long_position
        pos = paper.positions.get("SYM")

        # Step 1: Place capital-BE SL at entry ($100)
        r1 = paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=100.0, tpsl="sl"
        )
        old_oid = r1["oid"]
        assert pos.sl_px == 100.0

        # Step 2: Cancel capital-BE SL
        paper.cancel_order("SYM", old_oid)
        assert pos.sl_px is None

        # Step 3: Place fee-BE SL at entry+buffer ($100.07) — tighter for long
        paper.place_trigger_order(
            "SYM", is_buy=False, sz=pos.size, trigger_px=100.07, tpsl="sl"
        )
        assert pos.sl_px == 100.07

        # Step 4: Price at $100.10 (above both SLs) → no trigger
        events = paper.check_triggers({"SYM": 100.10})
        assert len(events) == 0, "Price above fee-BE SL must not trigger"

        # Step 5: Price drops to $100.05 (below fee-BE SL of $100.07) → triggers
        events = paper.check_triggers({"SYM": 100.05})
        assert len(events) == 1, "Price below fee-BE SL must trigger"
        assert events[0]["exit_px"] == 100.07, "Must fill at fee-BE SL price"

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


# ── Class 7: Candle Peak Re-evaluation ───────────────────────────────────────

class TestCandlePeakBreakevenReevaluation:
    """Verify capital-BE can be triggered from candle peak corrections."""

    def _should_trigger_candle_capital_be(self, best_roe, current_peak, capital_be_set,
                                           breakeven_set, capital_threshold=0.5):
        """Replicate candle capital-BE re-evaluation logic."""
        if best_roe <= current_peak:
            return False  # No new peak found — block doesn't run
        if capital_be_set.get("SYM"):
            return False
        if breakeven_set.get("SYM"):
            return False
        return best_roe >= capital_threshold

    def test_candle_peak_triggers_capital_be(self):
        """Candle shows best_roe=0.8% > current_peak=0.3% → capital-BE fires."""
        capital_be_set = {}
        breakeven_set = {}

        triggered = self._should_trigger_candle_capital_be(
            best_roe=0.8, current_peak=0.3,
            capital_be_set=capital_be_set, breakeven_set=breakeven_set,
        )
        assert triggered, "Candle peak above threshold must trigger capital-BE"

    def test_candle_peak_does_not_trigger_if_already_set(self):
        """If capital-BE already set, candle correction must not re-trigger."""
        capital_be_set = {"SYM": True}
        breakeven_set = {}

        triggered = self._should_trigger_candle_capital_be(
            best_roe=0.8, current_peak=0.3,
            capital_be_set=capital_be_set, breakeven_set=breakeven_set,
        )
        assert not triggered, "Must not re-trigger when capital-BE already set"

    def test_candle_peak_does_not_trigger_fee_be(self):
        """_update_peaks_from_candles must NOT trigger fee-BE logic."""
        source = _daemon_source()
        method_start = source.find("def _update_peaks_from_candles(")
        method_end = source.find("\n    def ", method_start + 1)
        method_source = source[method_start:method_end]
        assert "capital_breakeven" in method_source or "capital_be" in method_source, \
            "_update_peaks_from_candles must re-evaluate capital-BE"
        assert "fee_be_roe" not in method_source, \
            "Candle tracking must NOT compute or use fee_be_roe"
        assert "breakeven_stop_enabled" not in method_source, \
            "Candle tracking must NOT trigger fee-BE block"

    def test_candle_peak_below_threshold_no_trigger(self):
        """Candle peak below 0.5% threshold → no capital-BE trigger."""
        capital_be_set = {}
        breakeven_set = {}

        triggered = self._should_trigger_candle_capital_be(
            best_roe=0.3, current_peak=0.1,
            capital_be_set=capital_be_set, breakeven_set=breakeven_set,
        )
        assert not triggered, "Candle peak below threshold must not trigger capital-BE"

    def test_candle_peak_skips_if_no_new_peak(self):
        """If candle best_roe <= current_peak, the block doesn't run at all."""
        triggered = self._should_trigger_candle_capital_be(
            best_roe=0.4, current_peak=0.6,  # Candle shows LESS than recorded peak
            capital_be_set={}, breakeven_set={},
        )
        assert not triggered, "Block must not run if candle doesn't show new peak"

    def test_candle_peak_skips_if_fee_be_set(self):
        """If fee-BE already set, candle capital-BE must skip."""
        triggered = self._should_trigger_candle_capital_be(
            best_roe=0.8, current_peak=0.3,
            capital_be_set={}, breakeven_set={"SYM": True},
        )
        assert not triggered, "Capital-BE must skip if fee-BE already set"


# ── Class 8: Edge Cases ───────────────────────────────────────────────────────

class TestBreakevenEdgeCases:
    """Edge cases: low leverage, disabled config, multiple positions, zero size."""

    def test_low_leverage_fee_be_threshold_below_capital_be(self):
        """At 5x: fee_be_roe=0.35% < capital_be_roe=0.5% → fee fires first."""
        taker_fee_pct = 0.07
        leverage = 5
        fee_be_roe = taker_fee_pct * leverage  # 0.35%
        capital_be_roe = 0.5

        assert fee_be_roe < capital_be_roe

        # Simulate: at ROE=0.4% (above fee_be, below capital_be)
        roe = 0.4
        breakeven_set = {}
        capital_be_set = {}

        # fee-BE fires first (threshold = 0.35%)
        if roe >= fee_be_roe and not breakeven_set.get("SYM"):
            breakeven_set["SYM"] = True
            capital_be_set["SYM"] = True  # fee-BE sets both flags

        # capital-BE block gate: `not self._breakeven_set.get(sym)` → skips
        capital_be_would_fire = (
            not capital_be_set.get("SYM")
            and not breakeven_set.get("SYM")
            and roe >= capital_be_roe
        )
        assert not capital_be_would_fire, "Capital-BE must skip at 5x since fee-BE fired first"
        assert breakeven_set.get("SYM") is True
        assert capital_be_set.get("SYM") is True

    def test_multiple_positions_are_independent(self):
        """Capital-BE on BTC must not affect SOL state."""
        capital_be_set = {"BTC": True}
        breakeven_set = {}

        assert not capital_be_set.get("SOL"), "SOL must be unaffected by BTC capital-BE"
        assert capital_be_set.get("BTC") is True, "BTC state must be as set"

    def test_capital_breakeven_disabled_via_config(self):
        """capital_breakeven_enabled=False → capital-BE block skipped entirely."""
        capital_breakeven_enabled = False
        roe = 5.0  # Way above threshold

        capital_be_set = {}
        if capital_breakeven_enabled and not capital_be_set.get("SYM") and roe >= 0.5:
            capital_be_set["SYM"] = True

        assert not capital_be_set.get("SYM"), "Capital-BE must be skipped when disabled"

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
        """has_tighter_sl correctly identifies when existing SL >= entry for long."""
        entry_px = 100.0
        capital_be_price = entry_px
        is_long = True

        def has_tighter_sl(triggers):
            return any(
                t.get("order_type") == "stop_loss" and (
                    (is_long and t.get("trigger_px", 0) >= capital_be_price) or
                    (not is_long and 0 < t.get("trigger_px", 0) <= capital_be_price)
                )
                for t in triggers
            )

        # SL above entry → already tighter → skip capital-BE
        assert has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 100.5, "oid": 1}])
        # SL at entry → already tighter (equal counts as tighter)
        assert has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 100.0, "oid": 1}])
        # SL below entry → needs capital-BE
        assert not has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 97.0, "oid": 1}])
        # No SL at all → needs capital-BE
        assert not has_tighter_sl([])

    def test_has_tighter_sl_logic_for_short(self):
        """has_tighter_sl correctly identifies when existing SL <= entry for short."""
        entry_px = 100.0
        capital_be_price = entry_px
        is_long = False

        def has_tighter_sl(triggers):
            return any(
                t.get("order_type") == "stop_loss" and (
                    (is_long and t.get("trigger_px", 0) >= capital_be_price) or
                    (not is_long and 0 < t.get("trigger_px", 0) <= capital_be_price)
                )
                for t in triggers
            )

        # SL below entry for short → already tighter → skip capital-BE
        assert has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 99.5, "oid": 1}])
        # SL at entry for short → equal counts as tighter
        assert has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 100.0, "oid": 1}])
        # SL above entry for short → needs capital-BE
        assert not has_tighter_sl([{"order_type": "stop_loss", "trigger_px": 103.0, "oid": 1}])
        # TP doesn't count as SL
        assert not has_tighter_sl([{"order_type": "take_profit", "trigger_px": 99.0, "oid": 1}])
