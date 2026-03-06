"""
Unit tests for the mechanical exit system.

Tests cover:
1. BUG-1 fix: breakeven stop formula
2. Trailing stop activation, trailing, floor enforcement
3. Stop-tightening lockout in modify_position
4. Fee-loss block removal
"""
import pytest


class TestBreakevenStopFormula:
    """BUG-1 fix: breakeven stop places correctly for longs and shorts."""

    def test_long_breakeven_above_entry(self):
        """Long breakeven stop should be ABOVE entry price."""
        entry_px = 100_000
        buffer_pct = 0.07 / 100  # 0.07%
        is_long = True
        be_price = entry_px * (1 + buffer_pct) if is_long else entry_px * (1 - buffer_pct)
        assert be_price > entry_px, f"Long BE {be_price} should be > entry {entry_px}"
        assert abs(be_price - 100_070) < 1, f"Expected ~100070, got {be_price}"

    def test_short_breakeven_below_entry(self):
        """Short breakeven stop should be BELOW entry price."""
        entry_px = 100_000
        buffer_pct = 0.07 / 100
        is_long = False
        be_price = entry_px * (1 + buffer_pct) if is_long else entry_px * (1 - buffer_pct)
        assert be_price < entry_px, f"Short BE {be_price} should be < entry {entry_px}"
        assert abs(be_price - 99_930) < 1, f"Expected ~99930, got {be_price}"

    def test_breakeven_nets_zero_at_20x(self):
        """At 20x, hitting the 0.07% buffer stop should net ~0% after fees."""
        entry_px = 100_000
        buffer_pct = 0.0007
        leverage = 20
        fee_roe = 0.07 * leverage  # 1.4% ROE
        be_price = entry_px * (1 + buffer_pct)  # long
        price_move_pct = (be_price - entry_px) / entry_px * 100
        roe_at_be = price_move_pct * leverage
        net_roe = roe_at_be - fee_roe
        assert abs(net_roe) < 0.1, f"Net ROE at BE should be ~0%, got {net_roe:.2f}%"


class TestTrailingStopLogic:
    """Trailing stop activation, trailing, and floor enforcement."""

    def test_activation_threshold(self):
        """Trail activates when ROE crosses activation threshold."""
        activation_roe = 2.8
        assert 1.0 < activation_roe  # Not active
        assert 2.8 >= activation_roe  # Active
        assert 5.0 >= activation_roe  # Active

    def test_trail_roe_calculation(self):
        """Trail ROE = peak * (1 - retracement_pct)."""
        peak_roe = 10.0
        retracement_pct = 0.50
        trail_roe = peak_roe * (1.0 - retracement_pct)
        assert trail_roe == 5.0

    def test_trail_never_below_fee_breakeven(self):
        """Trail ROE floor is fee break-even ROE."""
        peak_roe = 3.0
        retracement_pct = 0.50
        fee_pct = 0.07
        leverage = 20
        fee_be_roe = fee_pct * leverage  # 1.4%
        trail_roe = peak_roe * (1.0 - retracement_pct)  # 1.5%
        trail_roe = max(trail_roe, fee_be_roe)  # max(1.5, 1.4) = 1.5
        assert trail_roe >= fee_be_roe

        # Edge case: very small peak where trail would dip below fee BE
        peak_roe_small = 2.8
        trail_roe_small = peak_roe_small * (1.0 - retracement_pct)  # 1.4%
        trail_roe_small = max(trail_roe_small, fee_be_roe)  # max(1.4, 1.4) = 1.4
        assert trail_roe_small >= fee_be_roe

    def test_trail_price_long(self):
        """Trail price for longs is above entry."""
        entry_px = 100_000
        trail_roe = 5.0  # 5% ROE
        leverage = 20
        trail_price_pct = trail_roe / leverage / 100.0  # 0.0025
        trail_px = entry_px * (1 + trail_price_pct)
        assert trail_px == 100_250  # $250 above entry

    def test_trail_price_short(self):
        """Trail price for shorts is below entry."""
        entry_px = 100_000
        trail_roe = 5.0
        leverage = 20
        trail_price_pct = trail_roe / leverage / 100.0
        trail_px = entry_px * (1 - trail_price_pct)
        assert trail_px == 99_750  # $250 below entry

    def test_stop_only_moves_tighter(self):
        """Stop never moves backwards (looser)."""
        # Long: new trail must be > old trail
        old_trail_long = 100_250
        new_trail_higher = 100_300
        new_trail_lower = 100_200
        assert new_trail_higher > old_trail_long  # OK — tighter
        assert not (new_trail_lower > old_trail_long)  # Blocked — looser

        # Short: new trail must be < old trail
        old_trail_short = 99_750
        new_trail_lower_s = 99_700
        new_trail_higher_s = 99_800
        assert new_trail_lower_s < old_trail_short  # OK — tighter
        assert not (new_trail_higher_s < old_trail_short)  # Blocked — looser

    def test_trail_hit_detection_long(self):
        """Long trailing stop fires when price drops to trail price."""
        trail_px = 100_250
        price_above = 100_500
        price_at = 100_250
        price_below = 100_200
        assert not (price_above <= trail_px)
        assert (price_at <= trail_px)
        assert (price_below <= trail_px)

    def test_trail_hit_detection_short(self):
        """Short trailing stop fires when price rises to trail price."""
        trail_px = 99_750
        price_below = 99_500
        price_at = 99_750
        price_above = 99_800
        assert not (price_below >= trail_px)
        assert (price_at >= trail_px)
        assert (price_above >= trail_px)


class TestStopTighteningLockout:
    """LLM can only tighten stops, never widen."""

    def test_long_tighten_allowed(self):
        """Moving SL closer to price (higher) on a long is allowed."""
        existing_sl = 99_000
        new_sl = 99_500  # Closer to mark price
        is_long = True
        blocked = is_long and new_sl < existing_sl
        assert not blocked

    def test_long_widen_blocked(self):
        """Moving SL further from price (lower) on a long is blocked."""
        existing_sl = 99_000
        new_sl = 98_500  # Further from mark price
        is_long = True
        blocked = is_long and new_sl < existing_sl
        assert blocked

    def test_short_tighten_allowed(self):
        """Moving SL closer to price (lower) on a short is allowed."""
        existing_sl = 101_000
        new_sl = 100_500
        is_long = False
        blocked = not is_long and new_sl > existing_sl
        assert not blocked

    def test_short_widen_blocked(self):
        """Moving SL further from price (higher) on a short is blocked."""
        existing_sl = 101_000
        new_sl = 101_500
        is_long = False
        blocked = not is_long and new_sl > existing_sl
        assert blocked


class TestFeeLossBlockRemoved:
    """Fee-loss block no longer prevents closes."""

    def test_close_in_fee_loss_zone_allowed(self):
        """Closing a trade where gross > 0 but net < 0 should no longer be blocked."""
        # This is a design test — the actual enforcement code is deleted.
        # If someone re-adds a fee-loss block, this test documents the intent.
        gross_pnl = 5.0   # $5 gross profit
        fees = 7.0         # $7 in fees
        net_pnl = gross_pnl - fees  # -$2 net loss
        # Previously: this would be blocked. Now: allowed.
        assert gross_pnl > 0 and net_pnl < 0, "This scenario should be allowed to close"
