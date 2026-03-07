# Fix 01: T1 — Stale Position Cache After 429

> **Priority:** Critical
> **Bug addressed:** T1 (stale `_prev_positions` after 429 causes ghost position management)
> **Files modified:** `src/hynous/intelligence/daemon.py` (1 file)
> **Estimated scope:** ~10 lines added
> **T3 status:** Phase 3 is **NOT deleted** — see rationale below

---

## Problem Summary

When `check_triggers()` closes a position, the daemon calls `get_user_state()` to refresh `_prev_positions`. In paper mode, `get_user_state()` calls `get_all_prices()` which makes an HTTP call to Hyperliquid mainnet. If this HTTP call gets a 429 (rate limit), `_prev_positions` is never updated — closed positions remain in the cache as ghost entries. Every subsequent 10s tick, the daemon runs ROE tracking, breakeven, and trailing stop logic on positions that no longer exist.

---

## Why Phase 3 Is Kept (T3 Reclassified)

Phase 3 (lines 1959-2006) was originally flagged for deletion as dead code. After deeper analysis, it serves a **legitimate error-path backup**:

1. Phase 2 updates `_trailing_stop_px[sym]` (line 1934) **before** the try block
2. Inside the try block, `cancel_order()` clears `pos.sl_px` to None (line 1941)
3. If `place_trigger_order()` then fails (line 1942), `pos.sl_px` remains None
4. `check_triggers()` checks `pos.sl_px` — which is now None — and won't fire any SL
5. Phase 3 checks `_trailing_stop_px[sym]` (the correct trail price) and catches the exit

Without Phase 3, a Phase 2 failure leaves the position with **no stop loss at all** — `cancel_order()` already cleared it, and `place_trigger_order()` failed to set the new one. Phase 3 is the only mechanism that would close this position at the trailing level.

The spurious `"Trailing stop close failed"` warning that Phase 3 produces when `check_triggers()` already handled the close is eliminated by this fix's event-based eviction: closed coins are removed from `_prev_positions`, so `if not pos: continue` (line 1806) skips Phase 3 for already-closed positions. Phase 3 only fires when it's genuinely needed.

---

## Prerequisites — Read Before Coding

Read these files **in this order**. Do not skip any.

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `docs/revisions/trade-mechanism-debug/README.md` | T1 section | Full bug analysis with code paths. |
| 2 | `src/hynous/intelligence/daemon.py` | 320-365 | **State dictionaries.** Understand `_prev_positions` (dict[str, dict]) and all tracking dicts that depend on it. |
| 3 | `src/hynous/intelligence/daemon.py` | 1750-2006 | **`_fast_trigger_check()` — THE method being modified.** Read the entire method: price fetch (1764-1776) → `check_triggers()` (1778-1798) → ROE tracking (1800-1822) → breakeven (1824-1886) → trailing Phase 1+2 (1888-1957) → Phase 3 (1959-2006). Understand how `position_syms` (line 1766) is captured BEFORE `check_triggers()` runs, but `_prev_positions` is read AFTER (line 1805). This is the guard that makes Phase 3 safe once eviction is applied. |
| 4 | `src/hynous/intelligence/daemon.py` | 855-923 | **Main loop.** Understand that `_fast_trigger_check()` runs every 10s (line 904), and `_check_positions()` runs every 60s (line 921). Both call `check_triggers()`. |
| 5 | `src/hynous/data/providers/paper.py` | 555-625 | **`check_triggers()`.** When an SL/TP fires, the position is **removed from `self.positions` internally** (via `_close_at_locked` which calls `self.positions.pop()`). Returns list of event dicts with `coin`, `side`, `entry_px`, `exit_px`, `realized_pnl`, `classification`. |
| 6 | `src/hynous/data/providers/paper.py` | 154-189 | **`get_user_state()`.** Calls `self.get_all_prices()` (line 156) which delegates to the real `HyperliquidProvider` — an HTTP call to Hyperliquid mainnet. If this fails (429), the entire method raises. |
| 7 | `src/hynous/data/providers/paper.py` | 302-311 | **`market_close()`.** Line 310-311: `if symbol not in self.positions: raise ValueError(...)`. Phase 3 hits this when it fires on a position already closed by `check_triggers()`. |
| 8 | `src/hynous/data/providers/hyperliquid.py` | 597-604 | **`get_all_prices()`.** No error handling — 429 exceptions propagate to all callers. |
| 9 | `src/hynous/intelligence/daemon.py` | 2388-2503 | **`_record_trigger_close()`.** Uses `self._prev_positions.get(coin, {})` on line 2437 to get leverage/size metadata. Must be called BEFORE we remove the coin from `_prev_positions`. |
| 10 | `src/hynous/intelligence/daemon.py` | 1933-1957 | **Phase 2 try/except.** Line 1934: `_trailing_stop_px[sym] = new_trail_px` is OUTSIDE the try block. Line 1941: `cancel_order()` clears `pos.sl_px`. Line 1942: `place_trigger_order()` can fail. This is why Phase 3 exists — it catches the gap when Phase 2 fails. |
| 11 | `tests/unit/test_mechanical_exits.py` | Full | **Existing tests.** Understand the test style — pure logic tests, no mocking of daemon. Your new tests follow this pattern. |

### Reference Only (Do Not Modify)

| File | Why |
|------|-----|
| `src/hynous/intelligence/daemon.py` lines 1959-2006 | Phase 3. **DO NOT DELETE.** Read to understand its role as Phase 2 failure backup. |
| `src/hynous/intelligence/daemon.py` lines 2203-2297 | `_check_positions()` — also calls `check_triggers()`. Not modified, but understand it has a parallel path with the same pattern. |
| `src/hynous/intelligence/daemon.py` lines 2744-2773 | `_check_profit_levels()` cleanup — cleans up stale tracking dicts. Not modified. |
| `src/hynous/intelligence/daemon.py` lines 1733-1748 | `_refresh_trigger_cache()` — called after trailing stop updates. Not modified in this fix. |

---

## Overview of Changes

One change in one file (`daemon.py`):

1. **Harden the `get_user_state()` call** (T1) — Evict closed positions from `_prev_positions` using event data BEFORE calling `get_user_state()`, then wrap `get_user_state()` in try/except

This single change fixes T1 and also makes Phase 3 safe:
- **T1 (stale cache):** Closed coins are evicted from `_prev_positions` even if `get_user_state()` fails
- **Phase 3 safety:** The ROE tracking loop reads `_prev_positions.get(sym)` (line 1805) — evicted coins return None, triggering `continue` (line 1807), which skips all trailing stop phases including Phase 3

---

## Change 1: Harden `get_user_state()` with Event-Based Eviction

**File:** `src/hynous/intelligence/daemon.py`
**Lines:** 1789-1798

### Current Code (BROKEN)

```python
            if events:
                for event in events:
                    self._position_types.pop(event["coin"], None)
                self._persist_position_types()
                state = provider.get_user_state()
                positions = state.get("positions", [])
                self._prev_positions = {
                    p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
                    for p in positions
                }
```

**Problem:** If `provider.get_user_state()` (line 1793) throws (429 from `get_all_prices()`), `_prev_positions` is never updated. The closed positions remain in the cache. Every subsequent 10s tick, the daemon thinks those positions are still open and tries to manage them — and Phase 3 tries to `market_close()` a position that no longer exists, producing error logs.

### Replace With

```python
            if events:
                for event in events:
                    self._position_types.pop(event["coin"], None)
                self._persist_position_types()
                # Immediately evict closed positions from cache using event data.
                # This guarantees stale positions are removed even if get_user_state() fails.
                # Also prevents Phase 3 from firing on already-closed positions
                # (the ROE loop's `if not pos: continue` guard reads _prev_positions).
                for event in events:
                    self._prev_positions.pop(event["coin"], None)
                # Try to get the full fresh state (also picks up any new positions)
                try:
                    state = provider.get_user_state()
                    positions = state.get("positions", [])
                    self._prev_positions = {
                        p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
                        for p in positions
                    }
                except Exception as e:
                    logger.warning("get_user_state() failed after trigger close, using event-based eviction: %s", e)
```

### How This Works

1. **Before** calling `get_user_state()`, we immediately remove closed positions from `_prev_positions` using the event data (`event["coin"]`). We know these positions are closed because `check_triggers()` already processed them.
2. **Then** we try `get_user_state()` as before — if it succeeds, `_prev_positions` gets a complete refresh (overwriting our partial eviction with the full truth).
3. **If `get_user_state()` fails** (429), we log a warning and continue. The closed positions are already evicted from step 1. The remaining positions in `_prev_positions` are still valid — they weren't touched by `check_triggers()`.

### Why This Makes Phase 3 Safe

The ROE tracking loop (line 1801) iterates `position_syms` — the list captured on line 1766 BEFORE `check_triggers()` ran. This list includes coins that were just closed. But on line 1805, it reads from `_prev_positions` (now evicted), gets None, and hits `continue` on line 1807. This skips ALL downstream logic for closed coins: ROE tracking, breakeven, trailing Phase 1, Phase 2, AND Phase 3. Phase 3 only fires when the position is genuinely still open (i.e., Phase 2 failed to register the new SL).

### Critical Ordering Note

`_record_trigger_close()` (called on line 1782) reads `self._prev_positions.get(coin, {})` on its line 2437 to get leverage/size metadata for the Nous record. This call happens on line 1782, **before** our new eviction on line ~1795. So the ordering is safe:

```
1779: events = check_triggers()         # positions closed internally in paper provider
1780: for event in events:
1782:   _record_trigger_close(event)     # reads _prev_positions for metadata ← BEFORE eviction
1789: if events:
1791:   _position_types.pop(...)
~1795:  _prev_positions.pop(...)         # NOW evict closed positions ← AFTER recording
~1797:  try: get_user_state()            # full refresh (may fail)
```

---

## After Changes: Final Method Shape

After applying the change, `_fast_trigger_check()` flows as:

```
_fast_trigger_check():
  1. Fetch fresh prices via get_all_prices()               [lines 1764-1776]
  2. check_triggers() → process events → record closes     [lines 1778-1787]
  3. If events: evict closed coins from _prev_positions,
     then try get_user_state() with fallback               [lines 1789-~1802]
  4. ROE tracking loop (skips evicted coins via guard)     [lines ~1804-~1826]
  5. Breakeven stop logic                                  [lines ~1828-~1890]
  6. Trailing stop Phase 1 + Phase 2                       [lines ~1892-~1961]
  7. Trailing stop Phase 3 (only fires if Phase 2 failed) [lines ~1963-~2010]
  8. Small wins mode                                       [lines ~2012+]
```

Phase 3 is preserved. It is naturally guarded by the `if not pos: continue` check (line 1806) for the normal close case, and fires only when Phase 2 fails to register the new SL — its intended purpose.

---

## Testing

### Static Tests (Unit)

**File to create:** `tests/unit/test_stale_cache_fix.py`

```python
"""
Unit tests for Fix 01: T1 (stale position cache after 429).

Tests verify:
1. Event-based eviction removes closed positions from _prev_positions
2. get_user_state() success overwrites the partial eviction with full truth
3. get_user_state() failure still leaves _prev_positions clean (no ghost positions)
4. Phase 3 is preserved (NOT deleted) as Phase 2 failure backup
5. Evicted coins are skipped by the ROE tracking guard
"""
import pytest


class TestEventBasedEviction:
    """T1 fix: closed positions are evicted from _prev_positions using event data."""

    def test_eviction_removes_closed_coin(self):
        """After check_triggers() closes BTC, BTC should be removed from _prev_positions."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        events = [
            {"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 99000,
             "realized_pnl": -10.0, "classification": "stop_loss"},
        ]
        for event in events:
            prev_positions.pop(event["coin"], None)

        assert "BTC" not in prev_positions, "Closed position should be evicted"
        assert "ETH" in prev_positions, "Unaffected position should remain"

    def test_eviction_handles_multiple_closes(self):
        """Multiple positions closing in one tick should all be evicted."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
            "SOL": {"side": "long", "size": 1.0, "entry_px": 150, "leverage": 5},
        }
        events = [
            {"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 99000,
             "realized_pnl": -10.0, "classification": "stop_loss"},
            {"coin": "ETH", "side": "short", "entry_px": 3500, "exit_px": 3600,
             "realized_pnl": -5.0, "classification": "stop_loss"},
        ]
        for event in events:
            prev_positions.pop(event["coin"], None)

        assert "BTC" not in prev_positions
        assert "ETH" not in prev_positions
        assert "SOL" in prev_positions, "Unaffected position should remain"

    def test_eviction_idempotent_for_unknown_coin(self):
        """Evicting a coin not in _prev_positions should not raise."""
        prev_positions = {"BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20}}
        events = [{"coin": "DOGE", "side": "long", "entry_px": 0.3, "exit_px": 0.28,
                    "realized_pnl": -1.0, "classification": "stop_loss"}]
        for event in events:
            prev_positions.pop(event["coin"], None)
        assert "BTC" in prev_positions

    def test_full_refresh_overwrites_partial_eviction(self):
        """If get_user_state() succeeds, its result replaces the evicted dict entirely."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        events = [{"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 99000,
                    "realized_pnl": -10.0, "classification": "stop_loss"}]

        # Step 1: evict
        for event in events:
            prev_positions.pop(event["coin"], None)

        # Step 2: simulate get_user_state() returning fresh data
        fresh_positions = [
            {"coin": "ETH", "side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
            {"coin": "SOL", "side": "long", "size": 1.0, "entry_px": 150, "leverage": 5},
        ]
        prev_positions = {
            p["coin"]: {"side": p["side"], "size": p["size"], "entry_px": p["entry_px"], "leverage": p.get("leverage", 20)}
            for p in fresh_positions
        }

        assert "BTC" not in prev_positions
        assert "ETH" in prev_positions
        assert "SOL" in prev_positions

    def test_fallback_after_failure_preserves_remaining(self):
        """If get_user_state() fails, remaining positions survive the eviction."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        events = [{"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 99000,
                    "realized_pnl": -10.0, "classification": "stop_loss"}]

        # Step 1: evict closed positions
        for event in events:
            prev_positions.pop(event["coin"], None)

        # Step 2: get_user_state() fails — we just keep what we have
        assert "BTC" not in prev_positions, "Closed position must be gone"
        assert "ETH" in prev_positions, "Open position must survive"
        assert prev_positions["ETH"]["entry_px"] == 3500, "Data must be intact"


class TestEvictedCoinsSkippedByGuard:
    """Evicted coins should be skipped by the ROE loop's `if not pos: continue` guard."""

    def test_guard_skips_evicted_coin(self):
        """After eviction, _prev_positions.get(coin) returns None → skipped."""
        prev_positions = {
            "ETH": {"side": "short", "size": 0.1, "entry_px": 3500, "leverage": 10},
        }
        # BTC was in the old position_syms list but has been evicted
        position_syms = ["BTC", "ETH"]

        processed = []
        for sym in position_syms:
            pos = prev_positions.get(sym)
            if not pos:
                continue  # This is line 1806-1807 in daemon.py
            processed.append(sym)

        assert "BTC" not in processed, "Evicted coin must be skipped"
        assert "ETH" in processed, "Open coin must be processed"

    def test_guard_skips_all_evicted(self):
        """If all positions closed, loop processes nothing."""
        prev_positions = {}  # all evicted
        position_syms = ["BTC", "ETH"]

        processed = []
        for sym in position_syms:
            pos = prev_positions.get(sym)
            if not pos:
                continue
            processed.append(sym)

        assert processed == []


class TestPhase3Preserved:
    """Phase 3 must NOT be deleted — it's a Phase 2 failure backup."""

    def test_phase3_still_exists(self):
        """Phase 3 backup close code must still exist in _fast_trigger_check."""
        import inspect
        from hynous.intelligence.daemon import Daemon

        source = inspect.getsource(Daemon._fast_trigger_check)
        assert "Phase 3" in source, "Phase 3 comment must still exist"
        assert "market_close" in source, "Phase 3 market_close must still exist"

    def test_all_three_phases_exist(self):
        """Phases 1, 2, and 3 must all exist."""
        import inspect
        from hynous.intelligence.daemon import Daemon

        source = inspect.getsource(Daemon._fast_trigger_check)
        assert "Phase 1" in source
        assert "Phase 2" in source
        assert "Phase 3" in source


class TestRecordingBeforeEviction:
    """Verify that _record_trigger_close can access _prev_positions data."""

    def test_metadata_available_before_eviction(self):
        """Leverage and size must be readable from _prev_positions before eviction."""
        prev_positions = {
            "BTC": {"side": "long", "size": 0.01, "entry_px": 100000, "leverage": 20},
        }
        event = {"coin": "BTC", "side": "long", "entry_px": 100000, "exit_px": 101000,
                 "realized_pnl": 5.0, "classification": "take_profit"}

        # Simulate reading metadata (as _record_trigger_close does on line 2437)
        pos_meta = prev_positions.get(event["coin"], {})
        leverage = int(pos_meta.get("leverage", 0))
        size = float(pos_meta.get("size", 0))
        assert leverage == 20
        assert size == 0.01

        # NOW evict
        prev_positions.pop(event["coin"], None)
        assert "BTC" not in prev_positions
```

**Run static tests:**

```bash
cd /Users/bauthoi/Documents/Hynous
PYTHONPATH=src pytest tests/unit/test_stale_cache_fix.py -v
```

Also run existing mechanical exit tests to confirm no regressions:

```bash
PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v
```

### Dynamic Tests (Live Environment)

These tests require the full daemon running in paper mode. Execute them in order.

#### Setup

```bash
# Terminal 1: Start Nous server
cd /Users/bauthoi/Documents/Hynous/nous-server && pnpm --filter server start

# Terminal 2: Start the daemon
cd /Users/bauthoi/Documents/Hynous && python -m scripts.run_daemon
```

Wait for the daemon to show `"Daemon started"` in logs.

#### Test D1: Position Close Clears Cache (No Ghost Positions)

**Purpose:** Confirm that after a position closes via SL, the daemon stops tracking it.

1. Open a position via dashboard Chat: `"Open a SOL long, $100, 10x leverage, SL at -3%"`
2. Wait for the SL to trigger (price drops 3% from entry) — or manually close: `"Close SOL position"`
3. After close, watch daemon logs for 30+ seconds
4. **Expected:**
   - No ROE tracking lines for SOL after close (`"Trailing stop ACTIVATED: SOL"` should not appear after close)
   - No breakeven attempts for SOL after close
   - No Phase 3 `"Trailing stop close failed"` warnings for SOL
   - Log should show the close event, then SOL disappears from all subsequent tracking
5. **Verify in dashboard:** Journal page should show the close. Debug page position list should not show SOL.

#### Test D2: 429 Resilience

**Purpose:** Confirm that if `get_user_state()` fails after a trigger close, the daemon continues functioning.

1. Open a position and let it run for a few minutes
2. If a 429 occurs naturally during a trigger close, you'll see: `"get_user_state() failed after trigger close, using event-based eviction: ..."` in logs
3. **Expected:** The daemon continues its 10s heartbeat without crashes. The closed position does not reappear in subsequent tracking.
4. **Note:** 429s are rare under normal load. The key test is D1 (normal close path). This test documents the expected behavior for the failure path.

#### Test D3: Trailing Stop Lifecycle

**Purpose:** Confirm trailing stops still work end-to-end with Phase 3 preserved.

1. Open a position via Chat: `"Open a BTC long, $200, 20x leverage, SL at -5%"`
2. Wait for price to move 2.8% ROE in your favor (activation)
3. Check logs for `"Trailing stop ACTIVATED: BTC"`
4. Check logs for `"Trailing stop UPDATED: BTC"` as price moves higher
5. When price retraces 50% of peak ROE (or hits the trailing SL), the position should close
6. **Expected:** Close event appears in logs and journal. No spurious Phase 3 warnings after the close.

---

## Verification Checklist

After implementing, verify each item:

- [ ] Phase 3 (lines 1959-2006) is **preserved** — NOT deleted
- [ ] The `if events:` block (line 1789) now evicts closed coins from `_prev_positions` BEFORE calling `get_user_state()`
- [ ] `get_user_state()` is wrapped in try/except with a warning log
- [ ] `_record_trigger_close()` calls (line 1782) happen BEFORE the eviction (ordering preserved)
- [ ] `PYTHONPATH=src pytest tests/unit/test_stale_cache_fix.py -v` — all pass
- [ ] `PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v` — all pass (no regressions)
- [ ] Daemon starts without import errors
- [ ] After a position close, no ghost position tracking or Phase 3 warnings in logs

---

Last updated: 2026-03-06
