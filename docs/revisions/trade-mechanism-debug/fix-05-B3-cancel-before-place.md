# Fix 05: B3 — Breakeven Must Cancel Old SL Before Placing New One

> **Priority:** Low
> **Bug addressed:** B3 (breakeven places SL without cancelling existing one — would create duplicate orders on live exchange)
> **Files modified:** `src/hynous/intelligence/daemon.py` (1 file)
> **Estimated scope:** ~5 lines added
> **Depends on:** Fix 02 (B1) must be applied first (uses fresh `_tracked_triggers`)

---

## Problem Summary

The breakeven block (daemon.py:1855-1863) calls `place_trigger_order()` to set the breakeven SL but never calls `cancel_order()` on the existing SL first.

In paper mode, this is benign — `place_trigger_order()` (paper.py:466) simply overwrites `pos.sl_px`, so the old value disappears. But on a live exchange, `place_trigger_order()` would CREATE a new order without removing the old one, resulting in duplicate SL orders with unpredictable execution.

The trailing stop code (daemon.py:1937-1941) already implements the correct cancel-before-place pattern. The breakeven block should follow the same pattern.

---

## Prerequisites — Read Before Coding

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `docs/revisions/trade-mechanism-debug/README.md` | B3 section | Full bug analysis. |
| 2 | `src/hynous/intelligence/daemon.py` | 1854-1863 | **Breakeven SL placement.** Missing the cancel step. |
| 3 | `src/hynous/intelligence/daemon.py` | 1936-1950 | **Trailing stop SL placement.** Correct pattern: cancel all existing SLs by OID, then place new one, then refresh cache. Copy this pattern. |
| 4 | `src/hynous/intelligence/daemon.py` | 1843-1851 | **`has_good_sl` check.** Already reads `self._tracked_triggers.get(sym, [])`. The same triggers list is used for the cancel loop. |
| 5 | `src/hynous/data/providers/paper.py` | 478-494 | **`cancel_order()`.** Matches by OID, clears `sl_px`/`tp_px`. Returns `True` if found. |
| 6 | `src/hynous/data/providers/paper.py` | 454-476 | **`place_trigger_order()`.** Line 466: `pos.sl_px = trigger_px`. Overwrites previous value (hides the bug in paper mode). |

---

## Overview of Changes

One change: add cancel-before-place to the breakeven block, following the trailing stop pattern exactly.

---

## Change 1: Cancel Existing SL Before Placing Breakeven SL

**File:** `src/hynous/intelligence/daemon.py`
**Lines:** 1854-1863

### Current Code

```python
                        else:
                            try:
                                sz = pos.get("size", 0)
                                self._get_provider().place_trigger_order(
                                    symbol=sym,
                                    is_buy=(side != "long"),  # long → SELL stop; short → BUY stop
                                    sz=sz,
                                    trigger_px=be_price,
                                    tpsl="sl",
                                )
```

### Replace With

```python
                        else:
                            try:
                                # Cancel existing SL before placing breakeven
                                # (mirrors trailing stop pattern at lines 1937-1941)
                                for t in triggers:
                                    if t.get("order_type") == "stop_loss" and t.get("oid"):
                                        self._get_provider().cancel_order(sym, t["oid"])
                                sz = pos.get("size", 0)
                                self._get_provider().place_trigger_order(
                                    symbol=sym,
                                    is_buy=(side != "long"),  # long → SELL stop; short → BUY stop
                                    sz=sz,
                                    trigger_px=be_price,
                                    tpsl="sl",
                                )
```

### Why This Works

The variable `triggers` is already defined on line 1844: `triggers = self._tracked_triggers.get(sym, [])`. It's the same list used by the `has_good_sl` check. We iterate over it to find any existing SL orders and cancel them by OID before placing the breakeven SL.

After Fix 02 (B1) is applied, the trigger cache is fresh (refreshed on new entry detection). So `triggers` will contain the agent's SL order if one exists, and we'll correctly cancel it before placing the breakeven SL.

**Note:** The `triggers` variable is already in scope — it was defined on line 1844 (inside the breakeven `if` block). No new variable needed.

---

## Testing

### Static Tests (Unit)

**File to create:** `tests/unit/test_cancel_before_place.py`

```python
"""
Unit tests for Fix 05: B3 (cancel old SL before placing breakeven SL).

Tests verify:
1. The cancel loop correctly identifies SL triggers
2. TP triggers are not cancelled
3. The cancel-before-place pattern exists in breakeven code
"""
import pytest


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
        import inspect
        from hynous.intelligence.daemon import Daemon

        source = inspect.getsource(Daemon._fast_trigger_check)

        # Find breakeven section
        be_start = source.find("Breakeven stop")
        assert be_start > 0, "Breakeven section must exist"

        # Find the breakeven placement section (after has_good_sl check)
        be_place = source.find("place_trigger_order", be_start)
        assert be_place > 0, "Breakeven must call place_trigger_order"

        # cancel_order must appear BEFORE place_trigger_order in the breakeven section
        be_cancel = source.find("cancel_order", be_start)
        assert be_cancel > 0, "Breakeven must call cancel_order"
        assert be_cancel < be_place, "cancel_order must come before place_trigger_order in breakeven"
```

**Run:**

```bash
cd /Users/bauthoi/Documents/Hynous
PYTHONPATH=src pytest tests/unit/test_cancel_before_place.py -v
```

### Dynamic Tests (Live Environment)

#### Setup

```bash
# Terminal 1: Nous server
cd /Users/bauthoi/Documents/Hynous/nous-server && pnpm --filter server start

# Terminal 2: Daemon
cd /Users/bauthoi/Documents/Hynous && python -m scripts.run_daemon
```

#### Test D1: Breakeven Replaces Agent SL Cleanly

1. Open a position via Chat: `"Open a BTC long, $200, 20x leverage, SL at -3%"`
2. Wait for position to become profitable enough for breakeven (ROE >= 1.4%)
3. Watch logs for `"breakeven_stop: BTC long"` message
4. **Verify via Debug page or provider state:** Only ONE SL order exists for BTC (the breakeven SL). The agent's original SL at -3% should be gone (cancelled before breakeven placed its own).

**In paper mode:** This is hard to verify directly since `pos.sl_px` is just a single value. The cancel is a no-op in terms of behavior (place already overwrites). But the code path executes correctly. The real verification is the static test above.

---

## Verification Checklist

- [ ] Cancel loop added before `place_trigger_order()` in breakeven block
- [ ] Cancel loop uses the `triggers` variable already defined on line 1844
- [ ] Cancel loop matches the trailing stop pattern exactly: `if t.get("order_type") == "stop_loss" and t.get("oid")`
- [ ] `PYTHONPATH=src pytest tests/unit/test_cancel_before_place.py -v` — all pass
- [ ] `PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v` — no regressions
- [ ] Daemon starts without errors

---

Last updated: 2026-03-06
