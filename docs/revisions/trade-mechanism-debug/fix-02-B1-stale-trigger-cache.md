# Fix 02: B1 — Stale Trigger Cache Causes Breakeven to Overwrite Agent SL

> **Priority:** High
> **Bug addressed:** B1 (breakeven logic reads stale `_tracked_triggers` and doesn't see agent-placed SL orders)
> **Files modified:** `src/hynous/intelligence/daemon.py` (1 file)
> **Estimated scope:** ~5 lines added

---

## Problem Summary

When the agent opens a position with an SL, the daemon's `_tracked_triggers` cache doesn't include the new SL until the next cache refresh (up to 300 seconds later via `_poll_derivatives()`). During this window, the breakeven logic reads the stale cache, sees no SL, and places its own breakeven SL — overwriting the agent's SL in the paper provider (because `place_trigger_order()` sets `pos.sl_px = trigger_px`, replacing any previous value).

The `has_good_sl` check (line 1845-1851) is correct logic — it properly compares SL prices to decide if breakeven should be skipped. It just operates on stale data.

---

## Prerequisites — Read Before Coding

| # | File | Lines | Why |
|---|------|-------|-----|
| 1 | `docs/revisions/trade-mechanism-debug/README.md` | B1 section | Full bug analysis with code paths and timing diagram. |
| 2 | `src/hynous/intelligence/daemon.py` | 1733-1748 | **`_refresh_trigger_cache()`** — the method to call. Reads `provider.get_trigger_orders()` and rebuilds `self._tracked_triggers`. |
| 3 | `src/hynous/intelligence/daemon.py` | 1824-1886 | **Breakeven stop logic.** Uses `self._tracked_triggers.get(sym, [])` on line 1844. The `has_good_sl` check on lines 1845-1851 compares trigger prices — this logic is correct, just needs fresh data. |
| 4 | `src/hynous/intelligence/daemon.py` | 2203-2297 | **`_check_positions()`** — where new position entries are detected. Two paths: paper (lines 2238-2249) and testnet/live (lines 2278-2289). Both detect new entries by checking `coin not in self._prev_positions`. |
| 5 | `src/hynous/data/providers/paper.py` | 195-233 | **`get_trigger_orders()`** — reads current SL/TP from `pos.sl_px`/`pos.tp_px`. This is what `_refresh_trigger_cache()` calls. In paper mode it's a pure local read (no HTTP), so it's cheap. |
| 6 | `src/hynous/data/providers/paper.py` | 454-476 | **`place_trigger_order()`** — line 466: `pos.sl_px = trigger_px`. Overwrites previous SL. This is why stale cache matters: breakeven places a new SL that silently replaces the agent's. |

### Existing Refresh Points (Reference Only)

`_refresh_trigger_cache()` is currently called at:

| Location | When | Line |
|----------|------|------|
| `_init_position_tracking()` | Daemon startup | 1727 |
| `_poll_derivatives()` | Every 300s | 1168 |
| Trailing stop Phase 2 | After updating trailing SL | 1950 |
| `_handle_position_close()` | When a fill is detected | 2348 |

**Missing:** After agent places a new trade. This is the gap that B1 exploits.

---

## Overview of Changes

One change: add a `_refresh_trigger_cache()` call in `_check_positions()` when new entries are detected.

---

## Change 1: Refresh Trigger Cache on New Position Entry

**File:** `src/hynous/intelligence/daemon.py`

Two insertion points — one for the paper path, one for the testnet/live path.

### Paper Path (lines 2238-2249)

#### Current Code

```python
                    # Entry detection in paper path — fires even when a close happened in the same cycle
                    for coin, curr_data in new_positions.items():
                        if coin not in self._prev_positions:
                            c_side = curr_data.get("side", "long")
                            c_lev = int(curr_data.get("leverage", 0))
                            c_entry = curr_data.get("entry_px", 0)
                            msg = f"Entered {coin} {c_side}"
                            if c_lev:
                                msg += f" ({c_lev}x)"
                            if c_entry:
                                msg += f" @ ${c_entry:,.0f}"
                            _notify_discord_simple(msg)
                    self._prev_positions = new_positions
                    return positions
```

#### Replace With

```python
                    # Entry detection in paper path — fires even when a close happened in the same cycle
                    has_new_entries = False
                    for coin, curr_data in new_positions.items():
                        if coin not in self._prev_positions:
                            has_new_entries = True
                            c_side = curr_data.get("side", "long")
                            c_lev = int(curr_data.get("leverage", 0))
                            c_entry = curr_data.get("entry_px", 0)
                            msg = f"Entered {coin} {c_side}"
                            if c_lev:
                                msg += f" ({c_lev}x)"
                            if c_entry:
                                msg += f" @ ${c_entry:,.0f}"
                            _notify_discord_simple(msg)
                    self._prev_positions = new_positions
                    if has_new_entries:
                        self._refresh_trigger_cache()
                    return positions
```

### Testnet/Live Path (lines 2278-2293)

#### Current Code

```python
            # Detect new positions (entries) and send clean Discord notification
            for coin, curr_data in current.items():
                if coin not in self._prev_positions:
                    c_side = curr_data.get("side", "long")
                    c_lev = int(curr_data.get("leverage", 0))
                    c_entry = curr_data.get("entry_px", 0)
                    msg = f"Entered {coin} {c_side}"
                    if c_lev:
                        msg += f" ({c_lev}x)"
                    if c_entry:
                        msg += f" @ ${c_entry:,.0f}"
                    _notify_discord_simple(msg)

            # Update snapshot
            self._prev_positions = current
            return positions
```

#### Replace With

```python
            # Detect new positions (entries) and send clean Discord notification
            has_new_entries = False
            for coin, curr_data in current.items():
                if coin not in self._prev_positions:
                    has_new_entries = True
                    c_side = curr_data.get("side", "long")
                    c_lev = int(curr_data.get("leverage", 0))
                    c_entry = curr_data.get("entry_px", 0)
                    msg = f"Entered {coin} {c_side}"
                    if c_lev:
                        msg += f" ({c_lev}x)"
                    if c_entry:
                        msg += f" @ ${c_entry:,.0f}"
                    _notify_discord_simple(msg)

            # Update snapshot
            self._prev_positions = current
            if has_new_entries:
                self._refresh_trigger_cache()
            return positions
```

### Why This Works

1. `_check_positions()` runs every 60s (line 921). When it detects a new position (agent placed a trade since the last check), it refreshes the trigger cache.
2. The very next `_fast_trigger_check()` tick (10s later) will read the fresh `_tracked_triggers`, which now includes the agent's SL.
3. The `has_good_sl` check will correctly evaluate the agent's SL price against the breakeven price.
4. If the agent's SL is above the breakeven price (tighter), breakeven skips. If it's below (wider), breakeven correctly moves the SL up.

### Why After `_prev_positions` Update

The `_refresh_trigger_cache()` call is placed AFTER `self._prev_positions = new_positions` / `self._prev_positions = current`. This is intentional — the cache refresh reads live state from the provider, which doesn't depend on `_prev_positions`. Ordering doesn't matter for correctness here, but placing it after the update groups all "new entry" side effects together.

---

## Testing

### Static Tests (Unit)

**File to create:** `tests/unit/test_stale_trigger_cache_fix.py`

```python
"""
Unit tests for Fix 02: B1 (stale trigger cache on new entry).

Tests verify:
1. has_good_sl logic correctly compares SL prices to breakeven
2. Stale cache (missing SL) causes has_good_sl = False
3. Fresh cache (with SL) causes has_good_sl = True when SL >= breakeven (long)
4. Fresh cache (with SL) causes has_good_sl = False when SL < breakeven (correctly upgrades)
"""
import pytest


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
        import inspect
        from hynous.intelligence.daemon import Daemon

        source = inspect.getsource(Daemon._check_positions)
        assert "_refresh_trigger_cache" in source, (
            "_check_positions must call _refresh_trigger_cache when new entries are detected"
        )
```

**Run:**

```bash
cd /Users/bauthoi/Documents/Hynous
PYTHONPATH=src pytest tests/unit/test_stale_trigger_cache_fix.py -v
```

### Dynamic Tests (Live Environment)

#### Setup

```bash
# Terminal 1: Nous server
cd /Users/bauthoi/Documents/Hynous/nous-server && pnpm --filter server start

# Terminal 2: Daemon
cd /Users/bauthoi/Documents/Hynous && python -m scripts.run_daemon
```

#### Test D1: Agent SL Survives Breakeven Window

**Purpose:** Confirm that the agent's SL is visible to the breakeven check immediately after entry.

1. Open a position via Chat: `"Open a BTC long, $200, 20x leverage, SL at -2%, TP at +5%"`
2. Watch daemon logs immediately after the position opens
3. Wait for `_check_positions()` to detect the new entry (up to 60s) — you'll see the Discord notification `"Entered BTC long (20x) @ $..."`
4. **Expected in logs:** If breakeven conditions are met (ROE >= 1.4% at 20x), you should see one of:
   - `breakeven_stop: BTC long` — breakeven placed (correct if agent's SL was below breakeven level)
   - No breakeven log — breakeven skipped because `has_good_sl` was True (agent's SL was already above breakeven)
5. **Verify:** Check the paper provider's actual SL price via the Debug page or Journal. The SL should be either:
   - The agent's original SL (if it was above breakeven) — NOT overwritten
   - The breakeven SL (if agent's original SL was below breakeven) — correctly upgraded

#### Test D2: Trailing Stop Doesn't Clobber Agent SL with Stale Cache

**Purpose:** The trailing stop also reads `_tracked_triggers` to cancel old SLs (line 1938). Verify this works after cache refresh.

1. Open a position and wait for trailing stop to activate (ROE >= 2.8%)
2. Watch for `"Trailing stop UPDATED"` log messages
3. **Expected:** Trailing stop should cancel the existing SL and place its own. With the cache refresh fix, it should find and cancel the correct SL OID.

---

## Verification Checklist

- [ ] Paper path in `_check_positions()` (around line 2249): `if has_new_entries: self._refresh_trigger_cache()` added
- [ ] Testnet/live path in `_check_positions()` (around line 2292): same pattern added
- [ ] `has_new_entries` flag is set to `True` when `coin not in self._prev_positions`
- [ ] `_refresh_trigger_cache()` is called AFTER `self._prev_positions` is updated
- [ ] `PYTHONPATH=src pytest tests/unit/test_stale_trigger_cache_fix.py -v` — all pass
- [ ] `PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v` — no regressions
- [ ] Daemon starts without errors
- [ ] After opening a position, logs show trigger cache refresh within 60s (you can add a temporary debug log in `_refresh_trigger_cache` to verify)

---

Last updated: 2026-03-06
