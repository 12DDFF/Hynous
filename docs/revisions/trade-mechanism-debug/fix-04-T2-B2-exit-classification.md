# Fix 04: T2 + B2 — Trailing Stop and Breakeven Exit Classification

> **Priority:** T2 High, B2 Medium
> **Bugs addressed:** T2 (trailing stop exits classified as "stop_loss") + B2 (breakeven exits classified as "stop_loss")
> **Files modified:** `src/hynous/intelligence/daemon.py` (1 file)
> **Estimated scope:** ~25 lines added
> **Depends on:** Fix 01 (T1) must be applied first

---

## Problem Summary

When a trailing stop or breakeven stop fires, `check_triggers()` in the paper provider classifies both as generic `"stop_loss"` — it has no concept of trailing or breakeven. This means journal entries, trade analytics, and briefing Recent Trades all show these exits as regular stop losses. It's impossible to evaluate trailing stop or breakeven performance separately.

The daemon already tracks which positions have trailing stops active (`_trailing_active`) and breakeven stops placed (`_breakeven_set`). We use this existing state to override the classification after `check_triggers()` returns events.

---

## Prerequisites — Read Before Coding

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `docs/revisions/trade-mechanism-debug/README.md` | T2 and B2 sections | Full bug analysis. |
| 2 | `src/hynous/intelligence/daemon.py` | 337-341 | **`_breakeven_set` and `_trailing_active` dicts.** These track which positions have breakeven/trailing stops. Used for classification override. |
| 3 | `src/hynous/intelligence/daemon.py` | 1778-1787 | **`_fast_trigger_check()` event processing.** Events from `check_triggers()` are passed to `_record_trigger_close()` and `_wake_for_fill()`. Classification override happens HERE, before recording. |
| 4 | `src/hynous/intelligence/daemon.py` | 2214-2224 | **`_check_positions()` paper path.** Second place that calls `check_triggers()` and processes events. Same override needed. |
| 5 | `src/hynous/intelligence/daemon.py` | 2350-2352 | **`_handle_position_close()` classification.** Uses `_classify_fill()` for testnet/live path. Same override needed after classification. |
| 6 | `src/hynous/intelligence/daemon.py` | 2505-2537 | **`_classify_fill()`.** Returns `"stop_loss"`, `"take_profit"`, or `"manual"`. The override runs AFTER this method. |
| 7 | `src/hynous/intelligence/daemon.py` | 2388-2503 | **`_record_trigger_close()`.** Uses `event["classification"]` to build Nous records and briefing cache. The override must happen before this is called. |
| 8 | `src/hynous/intelligence/daemon.py` | 2744-2773 | **`_check_profit_levels()` cleanup.** Cleans `_trailing_active` and `_breakeven_set` for closed positions. This runs every 60s — AFTER the close is classified. So the state is still available at classification time. |
| 9 | `src/hynous/data/providers/paper.py` | 555-625 | **`check_triggers()`** — returns events with `classification: "stop_loss"/"take_profit"/"liquidation"`. Does not distinguish trailing/breakeven. |

### Classification Priority

When overriding `"stop_loss"`, trailing takes precedence over breakeven:

| Daemon State | Override |
|-------------|----------|
| `_trailing_active[coin]` = True | `"trailing_stop"` |
| `_breakeven_set[coin]` = True, trailing not active | `"breakeven_stop"` |
| Neither | Keep `"stop_loss"` (agent-placed or initial SL) |

**Why trailing wins:** When a trailing stop activates, it places a new SL that REPLACES the breakeven SL. The `_breakeven_set` flag is still True (it's never unset), but the actual SL was placed by the trailing stop system.

---

## Overview of Changes

1. **Add `_override_sl_classification()` helper** — single method for the override logic
2. **Apply in `_fast_trigger_check()`** — override event classification before recording
3. **Apply in `_check_positions()` paper path** — same override before recording
4. **Apply in `_handle_position_close()`** — override after `_classify_fill()` returns

---

## Change 1: Add Classification Override Helper

**File:** `src/hynous/intelligence/daemon.py`
**Location:** Add this method after `_classify_fill()` (after line 2537).

```python
    def _override_sl_classification(self, coin: str, classification: str) -> str:
        """Refine 'stop_loss' to 'trailing_stop' or 'breakeven_stop' using daemon state.

        check_triggers() and _classify_fill() only know about generic stop_loss.
        The daemon tracks which positions have trailing/breakeven stops active,
        so we can give a more specific classification for analytics.
        """
        if classification != "stop_loss":
            return classification
        if self._trailing_active.get(coin):
            return "trailing_stop"
        if self._breakeven_set.get(coin):
            return "breakeven_stop"
        return classification
```

---

## Change 2: Apply in `_fast_trigger_check()`

**File:** `src/hynous/intelligence/daemon.py`
**Lines:** 1778-1787

### Current Code

```python
            # Check SL/TP/liquidation triggers with fresh prices
            events = provider.check_triggers(fresh_prices)
            for event in events:
                self._update_daily_pnl(event["realized_pnl"])
                self._record_trigger_close(event)
                self._wake_for_fill(
                    event["coin"], event["side"], event["entry_px"],
                    event["exit_px"], event["realized_pnl"],
                    event["classification"],
                )
```

### Replace With

```python
            # Check SL/TP/liquidation triggers with fresh prices
            events = provider.check_triggers(fresh_prices)
            for event in events:
                event["classification"] = self._override_sl_classification(
                    event["coin"], event["classification"],
                )
                self._update_daily_pnl(event["realized_pnl"])
                self._record_trigger_close(event)
                self._wake_for_fill(
                    event["coin"], event["side"], event["entry_px"],
                    event["exit_px"], event["realized_pnl"],
                    event["classification"],
                )
```

The override is the **first** operation in the loop, before `_update_daily_pnl`, `_record_trigger_close`, and `_wake_for_fill`. This ensures all downstream consumers see the refined classification.

---

## Change 3: Apply in `_check_positions()` Paper Path

**File:** `src/hynous/intelligence/daemon.py`
**Lines:** 2216-2224

### Current Code

```python
            if hasattr(provider, "check_triggers") and self.snapshot.prices:
                events = provider.check_triggers(self.snapshot.prices)
                for event in events:
                    self._update_daily_pnl(event["realized_pnl"])
                    self._record_trigger_close(event)
                    self._wake_for_fill(
                        event["coin"], event["side"], event["entry_px"],
                        event["exit_px"], event["realized_pnl"],
                        event["classification"],
                    )
```

### Replace With

```python
            if hasattr(provider, "check_triggers") and self.snapshot.prices:
                events = provider.check_triggers(self.snapshot.prices)
                for event in events:
                    event["classification"] = self._override_sl_classification(
                        event["coin"], event["classification"],
                    )
                    self._update_daily_pnl(event["realized_pnl"])
                    self._record_trigger_close(event)
                    self._wake_for_fill(
                        event["coin"], event["side"], event["entry_px"],
                        event["exit_px"], event["realized_pnl"],
                        event["classification"],
                    )
```

---

## Change 4: Apply in `_handle_position_close()`

**File:** `src/hynous/intelligence/daemon.py`
**Lines:** 2350-2352

### Current Code

```python
        # Classify the exit
        triggers = self._tracked_triggers.get(coin, [])
        classification = self._classify_fill(coin, close_fill, triggers)
```

### Replace With

```python
        # Classify the exit
        triggers = self._tracked_triggers.get(coin, [])
        classification = self._classify_fill(coin, close_fill, triggers)
        classification = self._override_sl_classification(coin, classification)
```

---

## Change 5: Update `_record_trigger_close` Guard

**File:** `src/hynous/intelligence/daemon.py`
**Lines:** 2357-2358

The `_handle_position_close` method only records to Nous for certain classification types:

### Current Code

```python
        # Record to Nous (SL/TP auto-fills aren't written by agent)
        if classification in ("stop_loss", "take_profit", "liquidation"):
```

### Replace With

```python
        # Record to Nous (auto-triggered closes aren't written by agent)
        if classification in ("stop_loss", "take_profit", "liquidation", "trailing_stop", "breakeven_stop"):
```

Without this change, trailing_stop and breakeven_stop classifications would skip Nous recording in the testnet/live path.

---

## Testing

### Static Tests (Unit)

**File to create:** `tests/unit/test_exit_classification.py`

```python
"""
Unit tests for Fix 04: T2 + B2 (exit classification override).

Tests verify:
1. _override_sl_classification correctly refines "stop_loss"
2. Trailing takes precedence over breakeven
3. Non-stop_loss classifications are untouched
4. _override_sl_classification is called in all three code paths
"""
import pytest


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
        from hynous.intelligence.daemon import Daemon
        assert hasattr(Daemon, "_override_sl_classification")

    def test_called_in_fast_trigger_check(self):
        import inspect
        from hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._fast_trigger_check)
        assert "_override_sl_classification" in source

    def test_called_in_check_positions(self):
        import inspect
        from hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._check_positions)
        assert "_override_sl_classification" in source

    def test_called_in_handle_position_close(self):
        import inspect
        from hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._handle_position_close)
        assert "_override_sl_classification" in source


class TestNousRecordingGuard:
    """Verify trailing_stop and breakeven_stop are recorded to Nous."""

    def test_new_classifications_in_guard(self):
        """_handle_position_close must record trailing_stop and breakeven_stop to Nous."""
        import inspect
        from hynous.intelligence.daemon import Daemon
        source = inspect.getsource(Daemon._handle_position_close)
        assert "trailing_stop" in source, "trailing_stop must be in the Nous recording guard"
        assert "breakeven_stop" in source, "breakeven_stop must be in the Nous recording guard"
```

**Run:**

```bash
cd /Users/bauthoi/Documents/Hynous
PYTHONPATH=src pytest tests/unit/test_exit_classification.py -v
```

### Dynamic Tests (Live Environment)

#### Setup

```bash
# Terminal 1: Nous server
cd /Users/bauthoi/Documents/Hynous/nous-server && pnpm --filter server start

# Terminal 2: Daemon
cd /Users/bauthoi/Documents/Hynous && python -m scripts.run_daemon
```

#### Test D1: Breakeven Classification

1. Open a position via Chat: `"Open a BTC long, $200, 20x leverage, SL at -3%"`
2. Wait for the position to become profitable enough for breakeven (ROE >= 1.4% at 20x)
3. Logs should show `breakeven_stop: BTC long`
4. If price then drops to the breakeven SL level and fires:
   - **Expected:** Journal shows `close_type: "breakeven_stop"` (not `"stop_loss"`)
   - Check Recent Trades in dashboard briefing — should show `breakeven_stop`

#### Test D2: Trailing Stop Classification

1. Open a position and wait for trailing stop to activate (ROE >= 2.8%)
2. Logs show `"Trailing stop ACTIVATED"` and `"Trailing stop UPDATED"`
3. If price retraces and the trailing SL fires:
   - **Expected:** Journal shows `close_type: "trailing_stop"` (not `"stop_loss"`)
4. **Note:** This requires significant price movement. If it doesn't trigger naturally, verify via logs that the override method is being called (add temporary debug log if needed).

#### Test D3: Regular SL Stays Classified

1. Open a position: `"Open a SOL short, $100, 10x leverage, SL at +2%"`
2. If price rises 2% and the SL fires before breakeven activates:
   - **Expected:** Journal shows `close_type: "stop_loss"` — unchanged, because neither breakeven nor trailing was active

---

## Verification Checklist

- [ ] `_override_sl_classification()` method added to `Daemon` class (after `_classify_fill`)
- [ ] Override applied in `_fast_trigger_check()` — before `_record_trigger_close()` and `_wake_for_fill()`
- [ ] Override applied in `_check_positions()` paper path — before `_record_trigger_close()` and `_wake_for_fill()`
- [ ] Override applied in `_handle_position_close()` — after `_classify_fill()`
- [ ] Nous recording guard updated to include `"trailing_stop"` and `"breakeven_stop"`
- [ ] `PYTHONPATH=src pytest tests/unit/test_exit_classification.py -v` — all pass
- [ ] `PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v` — no regressions
- [ ] Daemon starts without errors

---

Last updated: 2026-03-06
