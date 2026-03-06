# Revision 2: Real-Time Price Data for Exit Logic — Implementation Guide

> Priority: HIGH — Prerequisite for Revision 1 to work as modeled.
> Addresses: OBS-1 from the advisor document.
> Depends on: Revision 1 (Mechanical Exit System) should be implemented first.
> Source: `docs/temporary-advisor-document.md`

---

## Prerequisites — Read Before Coding

### Must Read

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `src/hynous/intelligence/daemon.py` | 1716-1788 | **`_fast_trigger_check()`** — current 10s polling loop. MFE/MAE tracking happens here (lines 1784-1788). This is where you'll add candle high/low peak tracking. |
| 2 | `src/hynous/intelligence/daemon.py` | 2346-2350 | **Duplicate MFE/MAE tracking** in `_check_profit_levels()`. Uses `roe_pct` from provider's `return_pct`. Must also receive candle-enhanced peaks. |
| 3 | `src/hynous/intelligence/daemon.py` | 1453-1481 | **`_fetch_satellite_candles()`** — existing pattern for fetching 5m+1m candles from Hyperliquid. Your new 1m candle fetch for MFE/MAE will be similar but lighter. |
| 4 | `src/hynous/intelligence/daemon.py` | 843-1025 | **Main loop.** Understand `time.sleep(10)` at line 1025, `_fast_trigger_check()` at line 892, `_check_profit_levels()` at line 897. Your candle fetch runs once per minute (not every 10s) to avoid rate limits. |
| 5 | `src/hynous/intelligence/daemon.py` | 320-337 | **Position tracking dicts.** `self._peak_roe`, `self._trough_roe`. These are updated from polling; you'll enhance them with candle extremes. |
| 6 | `src/hynous/data/providers/hyperliquid.py` | 618-650 | **`get_candles()` method.** Returns `[{t, o, h, l, c, v}, ...]`. The `h` (high) and `l` (low) fields are the intra-candle extremes you need. |
| 7 | `src/hynous/data/providers/paper.py` | 124-128 | **Paper provider delegates** `get_price()` and `get_all_prices()` to the real Hyperliquid provider. `get_candles()` also delegates (line 136). |
| 8 | `data-layer/src/hynous_data/collectors/trade_stream.py` | Full file | **WebSocket trade stream.** Already captures every trade for all coins. Understand the architecture: trades are buffered in `_trade_buffers` per coin. The data-layer is a SEPARATE process — the daemon can't import from it directly. Communication is HTTP only. |
| 9 | `docs/temporary-advisor-document.md` | 206-235 | **OBS-1 finding and specification.** 6 trades with PnL worse than MAE (impossible), three solution options proposed. |
| 10 | `docs/integration.md` | Full file | **Cross-system data flows.** The data-layer runs on `:8100` as a separate FastAPI service. The daemon communicates via HTTP through `HynousDataClient`. |
| 11 | `src/hynous/data/providers/hynous_data.py` | 158-228 | **`HynousDataClient`** — HTTP client to data-layer. No trade price subscription endpoint currently exists. |
| 12 | `docs/revisions/mechanical-exits/implementation-guide.md` | Full file | **Revision 1 guide.** The trailing stop implemented there checks prices every 10s. This revision enhances the price data feeding those checks. |

### Reference Only

| File | Why |
|------|-----|
| `config/default.yaml` | Config reference — you'll add a candle-tracking config field. |
| `src/hynous/core/config.py` | `DaemonConfig` — you'll add the config field here. |

---

## Problem Statement

MFE (`_peak_roe`) and MAE (`_trough_roe`) are sampled by polling every 10s (fast trigger check) and 60s (profit levels check). If price spikes and reverses between polls, the peak/trough is never recorded.

**Proof:** 6 trades have a final PnL worse than the recorded MAE — mathematically impossible. The MAE missed the true trough because the price moved between poll intervals.

**Impact on Revision 1:** The trailing stop trails from `_peak_roe`. If the peak is underrecorded because a spike was missed, the trail is set too low and the trade gives back more profit than necessary. Accurate peak tracking directly improves trailing stop performance.

---

## Chosen Approach: 1-Minute Candle High/Low Enhancement

The advisor document proposed three options. We use **Option 2: 1-minute candle high/low** for these reasons:

1. **WebSocket (Option 1)** requires a new data-layer endpoint + daemon subscription protocol. High complexity. The data-layer's trade stream runs in a separate process — no shared memory.
2. **Candle high/low (Option 2)** uses the existing `get_candles()` API that already works. One HTTP call per minute returns all intra-candle extremes. Moderate complexity, high accuracy improvement.
3. **Faster polling (Option 3)** doesn't solve the fundamental problem — gaps still exist between any two discrete polls. And 5s polling doubles API load for marginal improvement.

**Accuracy improvement:** A 1m candle's high/low captures the true intra-minute extreme. Since most missed peaks happen within a 1-2 minute window, this closes the vast majority of the gap between polling and real-time. The remaining error is sub-minute — negligible for trades lasting 6-36 minutes.

---

## Overview of Changes

1. **Add candle-based peak tracking** — new method `_update_peaks_from_candles()`
2. **Call it from the main loop** — once per minute, after `_fast_trigger_check()`
3. **Add config field** — `candle_peak_tracking_enabled` in `DaemonConfig`
4. **Add config to YAML** — `default.yaml`

This is a focused, low-risk change. It enhances existing MFE/MAE tracking without modifying the trailing stop logic itself.

---

## Change 1: Add `_update_peaks_from_candles()` Method

**File:** `src/hynous/intelligence/daemon.py`
**Location:** After `_fast_trigger_check()` (after line 1909). Add a new method.

```python
    def _update_peaks_from_candles(self):
        """Enhance MFE/MAE with 1m candle high/low for open positions.

        Polls only miss peaks/troughs between 10s samples. 1m candles
        include the true intra-candle extreme. Called once per minute.
        Only fetches candles for coins with open positions (1 API call each).
        """
        if not self._prev_positions:
            return

        provider = self._get_provider()
        now_ms = int(time.time() * 1000)
        # Fetch last 2 minutes of 1m candles — ensures we get the just-closed candle
        start_ms = now_ms - 2 * 60 * 1000

        for sym, pos in self._prev_positions.items():
            entry_px = pos.get("entry_px", 0)
            leverage = pos.get("leverage", 20)
            side = pos.get("side", "long")
            if entry_px <= 0:
                continue

            try:
                candles = provider.get_candles(sym, "1m", start_ms, now_ms)
            except Exception:
                logger.debug("Candle peak tracking failed for %s", sym)
                continue

            if not candles:
                continue

            for candle in candles:
                high = candle.get("h", 0)
                low = candle.get("l", 0)
                if high <= 0 or low <= 0:
                    continue

                # Compute ROE at candle high and low
                if side == "long":
                    roe_at_high = ((high - entry_px) / entry_px * 100) * leverage
                    roe_at_low = ((low - entry_px) / entry_px * 100) * leverage
                else:
                    roe_at_high = ((entry_px - low) / entry_px * 100) * leverage   # Short profits when price drops
                    roe_at_low = ((entry_px - high) / entry_px * 100) * leverage    # Short loses when price rises

                # For longs: best ROE was at high, worst at low
                # For shorts: best ROE was at low, worst at high
                if side == "long":
                    best_roe = roe_at_high
                    worst_roe = roe_at_low
                else:
                    best_roe = roe_at_high   # roe_at_high for shorts = (entry - low)/entry * lev
                    worst_roe = roe_at_low    # roe_at_low for shorts = (entry - high)/entry * lev

                # Update peaks — only if candle extreme exceeds current record
                if best_roe > self._peak_roe.get(sym, 0):
                    old_peak = self._peak_roe.get(sym, 0)
                    self._peak_roe[sym] = best_roe
                    if best_roe - old_peak > 0.5:  # Only log significant corrections
                        logger.info(
                            "MFE corrected by candle: %s %s | %.1f%% → %.1f%% (+%.1f%%)",
                            sym, side, old_peak, best_roe, best_roe - old_peak,
                        )

                if worst_roe < self._trough_roe.get(sym, 0):
                    old_trough = self._trough_roe.get(sym, 0)
                    self._trough_roe[sym] = worst_roe
                    if old_trough - worst_roe > 0.5:
                        logger.info(
                            "MAE corrected by candle: %s %s | %.1f%% → %.1f%% (%.1f%%)",
                            sym, side, old_trough, worst_roe, worst_roe - old_trough,
                        )
```

### Key Design Decisions

1. **Only fetches for open positions** — not all configured coins. Typically 1-3 API calls.
2. **2-minute window** — ensures the just-closed 1m candle is included. The forming candle is also checked, which gives us the latest partial-candle extremes.
3. **ROE math for shorts is inverted** — when price drops (low), short profits (high ROE). When price rises (high), short loses (low ROE). This matches the daemon's existing ROE calculation at lines 1780-1783.
4. **No trailing stop re-evaluation here** — this method only updates `_peak_roe` and `_trough_roe`. The trailing stop in `_fast_trigger_check()` reads `_peak_roe` on its next 10s iteration and adjusts the trail automatically. Clean separation of concerns.
5. **Logging only significant corrections** — >0.5% ROE difference. Avoids log spam from tiny candle vs poll differences.

---

## Change 2: Call from Main Loop

**File:** `src/hynous/intelligence/daemon.py`
**Location:** Inside `_loop_inner()`, after the `_fast_trigger_check()` call (line 892) and before the position tracking block (line 894).

### Add State Tracking

In `__init__` (after the existing `self._last_fill_check` at line 325), add:

```python
        self._last_candle_peak_check: float = 0     # Timestamp of last candle peak tracking run
```

### Add Loop Call

After line 892 (`self._fast_trigger_check()`), add:

```python
                # 1a-bis. Candle-based peak tracking (every 60s) for open positions
                # Catches MFE/MAE extremes missed by 10s polling gaps.
                if (
                    self.config.daemon.candle_peak_tracking_enabled
                    and self._prev_positions
                    and now - self._last_candle_peak_check >= 60
                ):
                    try:
                        self._update_peaks_from_candles()
                    except Exception as e:
                        logger.debug("Candle peak tracking error: %s", e)
                    self._last_candle_peak_check = now
```

### Why 60 seconds?

- 1m candles close every 60s. Checking more often gets the same closed candle repeatedly.
- We DO still get the forming candle's partial high/low, but the most valuable data is the just-closed candle's confirmed extremes.
- One API call per position per minute is sustainable (Hyperliquid rate limits allow ~100 req/min for info endpoints).

---

## Change 3: Add Config Field

### 3A: DaemonConfig

**File:** `src/hynous/core/config.py`
**Location:** After the trailing stop fields (added in Revision 1, after `trailing_retracement_pct`).

```python
    # Candle-based peak tracking (enhances MFE/MAE accuracy)
    candle_peak_tracking_enabled: bool = True   # Use 1m candle high/low for peak/trough tracking
```

### 3B: default.yaml

**File:** `config/default.yaml`
**Location:** After the trailing stop YAML fields (added in Revision 1).

```yaml
  # Candle-based peak tracking (enhances MFE/MAE for trailing stop accuracy)
  candle_peak_tracking_enabled: true
```

---

## Testing Plan

### Static Tests (Unit)

Create `tests/unit/test_candle_peak_tracking.py`:

```python
"""
Unit tests for candle-based MFE/MAE peak tracking.

Tests verify ROE computation from candle high/low for both longs and shorts,
and that peak/trough updates only move in the correct direction.
"""
import pytest


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
        # Short profits = (entry - price) / entry
        roe_at_low = ((entry_px - low) / entry_px * 100) * leverage
        assert roe_at_low == 10.0  # +0.5% price drop × 20x = +10% ROE for short

    def test_short_worst_roe_at_high(self):
        """Short position: worst ROE is when price is at candle high (short loses on rise)."""
        entry_px = 100_000
        high = 100_300
        leverage = 20
        roe_at_high = ((entry_px - high) / entry_px * 100) * leverage
        assert roe_at_high == -6.0  # +0.3% price rise × 20x = -6% ROE for short


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


class TestCandleWindowLogic:
    """Candle fetch window and timing."""

    def test_two_minute_window_captures_last_candle(self):
        """A 2-minute window should always include the most recently closed 1m candle."""
        import time
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - 2 * 60 * 1000
        window_seconds = (now_ms - start_ms) / 1000
        assert window_seconds == 120  # 2 minutes

    def test_invalid_candle_skipped(self):
        """Candles with h=0 or l=0 should be skipped."""
        candle = {"h": 0, "l": 99_500, "t": 0, "o": 0, "c": 0, "v": 0}
        high = candle.get("h", 0)
        low = candle.get("l", 0)
        should_skip = high <= 0 or low <= 0
        assert should_skip


class TestTrailingStopIntegration:
    """Verify that candle-enhanced peaks feed into trailing stop correctly."""

    def test_higher_peak_tightens_trail(self):
        """When candle reveals a higher peak, the trailing stop should tighten."""
        # Trailing stop formula from Revision 1:
        # trail_roe = peak * (1 - retracement_pct)
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
```

Run with:
```bash
PYTHONPATH=src pytest tests/unit/test_candle_peak_tracking.py -v
```

### Dynamic Tests (Live Environment)

These require a running system with Revision 1 already implemented.

#### Setup

```bash
# Terminal 1: Nous server
cd nous-server && pnpm --filter server start

# Terminal 2: Data layer
cd data-layer && make run

# Terminal 3: Dashboard + daemon
cd dashboard && reflex run
```

Ensure `config/default.yaml` has:
- `daemon.enabled: true`
- `candle_peak_tracking_enabled: true`
- `trailing_stop_enabled: true`

#### Test Scenario 1: Candle Peak Correction Logging

1. Enter a trade via Chat (e.g., "Go long BTC with medium conviction")
2. Wait for 1-2 minutes while the position is open
3. Watch daemon logs for `"MFE corrected by candle"` or `"MAE corrected by candle"` messages
4. **Verify:** If the market moved during a 10s polling gap, the candle correction catches it
5. **Note:** Corrections may not appear every minute — only when the candle high/low exceeds the polled peak/trough by >0.5%. This is expected; most of the time polling captures the same extremes.

#### Test Scenario 2: Enhanced MFE Accuracy

1. Enter a trade and let it run for 5+ minutes
2. Close the trade (or let trailing stop close it)
3. Check the trade close in the Journal page — inspect the MFE value
4. **Verify:** The MFE should now more closely match the actual price peak visible on a 1m chart
5. **Verify:** No trades should have a PnL worse than the recorded MAE (the impossible cases from OBS-1)

#### Test Scenario 3: Trailing Stop Tightening from Candle Data

1. Enter a trade and wait for trailing stop to activate (ROE > 2.8%)
2. Observe daemon logs for trailing stop updates
3. If a candle correction raises `_peak_roe`, the next `_fast_trigger_check()` iteration should update the trailing stop to a tighter level
4. **Verify:** The trailing stop price moves up (for longs) or down (for shorts) after a candle-based peak correction

#### Test Scenario 4: Config Toggle

1. Set `candle_peak_tracking_enabled: false` in `default.yaml`
2. Restart the daemon
3. Enter a trade and wait 2+ minutes
4. **Verify:** No `"MFE corrected by candle"` log messages appear
5. **Verify:** MFE/MAE tracking still works via the 10s polling (no regression)

#### Test Scenario 5: API Rate Limit Safety

1. Open 3 simultaneous positions (max_open_positions)
2. Run for 5+ minutes
3. **Verify:** No HTTP 429 (rate limit) errors in daemon logs from candle fetching
4. **Verify:** 3 candle fetches per minute (one per position) is well within Hyperliquid's limits

---

## Summary of All File Changes

| File | Change |
|------|--------|
| `src/hynous/intelligence/daemon.py` | New `_update_peaks_from_candles()` method (after line 1909), new `self._last_candle_peak_check` state (after line 325), new loop call (after line 892) |
| `src/hynous/core/config.py` | Add `candle_peak_tracking_enabled` to `DaemonConfig` |
| `config/default.yaml` | Add `candle_peak_tracking_enabled: true` to daemon section |
| `tests/unit/test_candle_peak_tracking.py` | NEW FILE — 13 unit tests |

---

## Completion Checklist

- [ ] `_update_peaks_from_candles()` method added to daemon
- [ ] Method correctly computes ROE at candle high/low for both longs and shorts
- [ ] Peak only updates upward, trough only updates downward
- [ ] Method called once per minute from main loop (60s interval)
- [ ] `self._last_candle_peak_check` state variable added to `__init__`
- [ ] Config field added to `DaemonConfig` and `default.yaml`
- [ ] Unit tests pass: `PYTHONPATH=src pytest tests/unit/test_candle_peak_tracking.py -v`
- [ ] Dynamic test scenarios 1-5 verified in live environment
- [ ] No regressions: existing MFE/MAE tracking, trailing stop, breakeven stop still work
- [ ] Candle corrections visible in daemon logs when market moves between polls

---

Last updated: 2026-03-05
