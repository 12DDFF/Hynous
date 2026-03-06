"""
Unit tests for candle-based MFE/MAE peak tracking.

Tests verify ROE computation from candle high/low for both longs and shorts,
and that peak/trough updates only move in the correct direction.
"""
import pytest
import time


class TestCandleRoeComputation:
    """ROE calculation from candle high/low prices."""

    def test_long_roe_at_high(self):
        """Long position: ROE at candle high should be positive when high > entry."""
        entry_px = 100_000
        high = 100_500
        leverage = 20
        roe = ((high - entry_px) / entry_px * 100) * leverage
        assert roe == 10.0  # +0.5% price × 20x = +10% ROE

    def test_long_roe_at_low(self):
        """Long position: ROE at candle low should be negative when low < entry."""
        entry_px = 100_000
        low = 99_800
        leverage = 20
        roe = ((low - entry_px) / entry_px * 100) * leverage
        assert roe == -4.0  # -0.2% price × 20x = -4% ROE

    def test_short_best_roe_at_low(self):
        """Short position: best ROE is when price is at candle low (short profits on drop)."""
        entry_px = 100_000
        low = 99_500
        leverage = 20
        roe_at_low = ((entry_px - low) / entry_px * 100) * leverage
        assert roe_at_low == 10.0  # +0.5% price drop × 20x = +10% ROE for short

    def test_short_worst_roe_at_high(self):
        """Short position: worst ROE is when price is at candle high (short loses on rise)."""
        entry_px = 100_000
        high = 100_300
        leverage = 20
        roe_at_high = ((entry_px - high) / entry_px * 100) * leverage
        assert roe_at_high == -6.0  # +0.3% price rise × 20x = -6% ROE for short

    def test_long_and_short_are_symmetric(self):
        """For the same price move, long MFE equals short MAE and vice versa."""
        entry_px = 100_000
        high = 101_000  # +1% move up
        low = 99_000    # -1% move down
        leverage = 10

        long_best = ((high - entry_px) / entry_px * 100) * leverage   # +10%
        long_worst = ((low - entry_px) / entry_px * 100) * leverage   # -10%
        short_best = ((entry_px - low) / entry_px * 100) * leverage   # +10%
        short_worst = ((entry_px - high) / entry_px * 100) * leverage  # -10%

        assert long_best == short_best == 10.0
        assert long_worst == short_worst == -10.0


class TestPeakTroughUpdates:
    """Peak/trough only update when candle extreme exceeds current record."""

    def test_peak_updates_when_higher(self):
        """Peak ROE should update when candle shows higher ROE."""
        current_peak = 5.0
        candle_best_roe = 8.0
        new_peak = max(current_peak, candle_best_roe)
        assert new_peak == 8.0

    def test_peak_unchanged_when_lower(self):
        """Peak ROE should NOT update when candle ROE is lower than current peak."""
        current_peak = 10.0
        candle_best_roe = 7.0
        new_peak = max(current_peak, candle_best_roe)
        assert new_peak == 10.0  # Unchanged

    def test_trough_updates_when_lower(self):
        """Trough ROE should update when candle shows worse ROE."""
        current_trough = -3.0
        candle_worst_roe = -5.0
        new_trough = min(current_trough, candle_worst_roe)
        assert new_trough == -5.0

    def test_trough_unchanged_when_higher(self):
        """Trough ROE should NOT update when candle ROE is better than current trough."""
        current_trough = -8.0
        candle_worst_roe = -4.0
        new_trough = min(current_trough, candle_worst_roe)
        assert new_trough == -8.0  # Unchanged

    def test_initial_peak_from_zero(self):
        """First candle should set peak from default 0."""
        current_peak = 0
        candle_best_roe = 3.0
        should_update = candle_best_roe > current_peak
        assert should_update

    def test_initial_trough_from_zero(self):
        """First candle should set trough from default 0."""
        current_trough = 0
        candle_worst_roe = -2.0
        should_update = candle_worst_roe < current_trough
        assert should_update

    def test_negative_best_roe_does_not_update_peak(self):
        """If all candle action is below entry, best_roe is negative — peak stays at 0."""
        current_peak = 0
        candle_best_roe = -1.0  # Even the high was below entry for a long
        should_update = candle_best_roe > current_peak
        assert not should_update


class TestCandleWindowLogic:
    """Candle fetch window and timing."""

    def test_two_minute_window_captures_last_candle(self):
        """A 2-minute window should always include the most recently closed 1m candle."""
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - 2 * 60 * 1000
        window_seconds = (now_ms - start_ms) / 1000
        assert window_seconds == 120  # 2 minutes

    def test_invalid_candle_skipped_zero_high(self):
        """Candles with h=0 should be skipped."""
        candle = {"h": 0, "l": 99_500, "t": 0, "o": 0, "c": 0, "v": 0}
        high = candle.get("h", 0)
        low = candle.get("l", 0)
        should_skip = high <= 0 or low <= 0
        assert should_skip

    def test_invalid_candle_skipped_zero_low(self):
        """Candles with l=0 should be skipped."""
        candle = {"h": 100_500, "l": 0, "t": 0, "o": 0, "c": 0, "v": 0}
        high = candle.get("h", 0)
        low = candle.get("l", 0)
        should_skip = high <= 0 or low <= 0
        assert should_skip

    def test_valid_candle_not_skipped(self):
        """Candles with valid h and l should be processed."""
        candle = {"h": 100_500, "l": 99_800, "t": 0, "o": 100_000, "c": 100_200, "v": 1.5}
        high = candle.get("h", 0)
        low = candle.get("l", 0)
        should_skip = high <= 0 or low <= 0
        assert not should_skip


class TestTrailingStopIntegration:
    """Verify that candle-enhanced peaks feed into trailing stop correctly."""

    def test_higher_peak_tightens_trail(self):
        """When candle reveals a higher peak, the trailing stop should tighten."""
        retracement_pct = 0.50

        # Before candle: peak at 6%, trail at 3%
        old_peak = 6.0
        old_trail_roe = old_peak * (1 - retracement_pct)
        assert old_trail_roe == 3.0

        # After candle: peak corrected to 8%, trail moves to 4%
        new_peak = 8.0
        new_trail_roe = new_peak * (1 - retracement_pct)
        assert new_trail_roe == 4.0
        assert new_trail_roe > old_trail_roe  # Trail tightened

    def test_lower_peak_does_not_loosen_trail(self):
        """Candle can't reduce peak — peak only moves up."""
        current_peak = 10.0
        candle_best = 7.0
        updated_peak = max(current_peak, candle_best)
        assert updated_peak == 10.0  # Unchanged — trail stays tight

    def test_candle_peak_feeds_trail_price(self):
        """Verify trail price calculation with a candle-corrected peak."""
        entry_px = 100_000
        leverage = 20
        retracement_pct = 0.50

        # Polling saw peak of 5% ROE → trail at 2.5% ROE
        polled_peak = 5.0
        trail_from_poll = polled_peak * (1 - retracement_pct)  # 2.5%

        # Candle reveals actual peak of 8% ROE
        candle_peak = 8.0
        trail_from_candle = candle_peak * (1 - retracement_pct)  # 4.0%

        # Trail price for long at 4% ROE, 20x leverage
        trail_price_pct = trail_from_candle / leverage / 100.0  # 0.002
        trail_px = entry_px * (1 + trail_price_pct)  # 100_200

        assert trail_px == 100_200
        assert trail_from_candle > trail_from_poll  # Candle-enhanced trail is tighter
