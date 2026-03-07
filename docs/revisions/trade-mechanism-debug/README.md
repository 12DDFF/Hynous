# Trade Mechanism Debug — Implementation Guide

> 6 bugs + 1 systemic issue identified in the mechanical exit system (trailing stops, breakeven stops).
> All issues affect live position management in `daemon.py` and `paper.py`.

---

## Table of Contents

1. [T1 — Stale Position Cache After 429 (Critical)](#t1--stale-position-cache-after-429-critical)
2. [T2 — Trailing Stop Exits Misclassified as "stop_loss" (High)](#t2--trailing-stop-exits-misclassified-as-stop_loss-high)
3. [T3 — Phase 3 Backup Close Fires on Broken State (Medium)](#t3--phase-3-backup-close-fires-on-broken-state-medium)
4. [B1 — Stale Trigger Cache Causes Breakeven to Overwrite Tighter SL (High)](#b1--stale-trigger-cache-causes-breakeven-to-overwrite-tighter-sl-high)
5. [B2 — Breakeven Exits Misclassified as "stop_loss" (Medium)](#b2--breakeven-exits-misclassified-as-stop_loss-medium)
6. [B3 — Breakeven Doesn't Cancel Old SL Before Placing New One (Low)](#b3--breakeven-doesnt-cancel-old-sl-before-placing-new-one-low)
7. [S1 — Hyperliquid 429 Rate Limiting Cascades (High)](#s1--hyperliquid-429-rate-limiting-cascades-high)

---

## T1 — Stale Position Cache After 429 (Critical)

### Symptoms

- Log message: `"Trailing stop close failed for {sym}: No open position for {sym}"`
- Trailing stop repeatedly tries to close a position that was already closed
- Positions appear "stuck" in the daemon's view even after they've been closed by a trigger

### Root Cause

The trailing stop Phase 3 backup close (`daemon.py:1959-2006`) calls `market_close()` on a position. But the daemon's `_prev_positions` cache — which tells it what positions are open — is only updated via `get_user_state()` (`daemon.py:1782-1798`). In the paper provider, `get_user_state()` calls `get_all_prices()` (`paper.py:154-189`), which makes an HTTP call to Hyperliquid's `all_mids` endpoint.

When this HTTP call gets a 429 rate-limit response, it raises an unhandled exception (`hyperliquid.py:597-604`). The `_fast_trigger_check()` method catches the exception at a broad level, but **`_prev_positions` never gets updated**. So on the next tick (10 seconds later), the daemon still thinks the old positions are open and tries to manage them again.

**Code path:**

```
_fast_trigger_check()  (daemon.py:1750)
  → check_triggers()   (paper.py:555)    # closes position internally
  → get_user_state()   (paper.py:154)    # tries to refresh _prev_positions
    → get_all_prices() (paper.py:168)    # HTTP call to Hyperliquid
      → _info.all_mids() (hyperliquid.py:597)  # 429 → EXCEPTION
  → _prev_positions NOT updated          # still contains the closed position
  → next tick: trailing stop Phase 3 tries market_close() on non-existent position
  → ValueError("No open position for {sym}")
```

**Key files:**
- `src/hynous/intelligence/daemon.py:1750-1798` — `_fast_trigger_check()`, the `get_user_state()` call
- `src/hynous/intelligence/daemon.py:1959-2006` — Phase 3 backup close
- `src/hynous/data/providers/paper.py:154-189` — `get_user_state()` calling `get_all_prices()`
- `src/hynous/data/providers/paper.py:302-351` — `market_close()` raising ValueError
- `src/hynous/data/providers/hyperliquid.py:597-604` — `get_all_prices()` with no error handling

### Fix

1. **Wrap `get_user_state()` in try/except in `_fast_trigger_check()`** — if it fails, log a warning and skip the rest of the tick. Do NOT proceed with stale `_prev_positions`.
2. **Add retry with backoff to `get_all_prices()` in `hyperliquid.py`** — catch 429 and retry once after a short delay (e.g., 1 second).
3. **Delete Phase 3 entirely** (see T3 below) — this removes the code that actually crashes on stale state.

### Priority: Critical — this causes error spam and prevents trailing stops from functioning after any 429 event.

---

## T2 — Trailing Stop Exits Misclassified as "stop_loss" (High)

### Symptoms

- Journal entries show trailing stop closes as regular "stop_loss" instead of "trailing_stop"
- No way to distinguish trailing stop exits from regular SL exits in trade analytics
- Breakeven stops also appear as "stop_loss" (see B2)

### Root Cause

When the trailing stop activates, it places a new SL trigger order at the trailing price via `place_trigger_order()` (`daemon.py:1928-1940`). This order is a standard `tp_sl` order with `is_buy` flipped and `trigger_px` set.

Later, `check_triggers()` in the paper provider (`paper.py:555-625`) evaluates all trigger orders. When the trailing SL fires, it classifies the close as `"stop_loss"` because it's just a regular SL trigger order — `check_triggers()` has no concept of trailing stops. It checks `pos.sl_px` and returns `reason="stop_loss"`.

The classification chain:

```
Trailing stop activates → places SL order → check_triggers() fires it
  → event = {"reason": "stop_loss"}    # no trailing stop classification exists
  → _handle_position_close() → _classify_fill() → records "stop_loss"
  → journal shows "stop_loss" instead of "trailing_stop"
```

**Key files:**
- `src/hynous/data/providers/paper.py:555-625` — `check_triggers()` only knows `"stop_loss"`, `"take_profit"`, `"liquidation"`
- `src/hynous/intelligence/daemon.py:2299-2386` — `_handle_position_close()` uses event reason
- `src/hynous/intelligence/daemon.py:2505-2537` — `_classify_fill()` fallback logic

### Fix

1. **Tag trailing stop SLs in the daemon** — when `_fast_trigger_check()` places a trailing SL, store the symbol in a set like `_trailing_sl_placed: set[str]`.
2. **In `_handle_position_close()`** — if the fill reason is `"stop_loss"` and the symbol is in `_trailing_sl_placed`, override the classification to `"trailing_stop"`.
3. **Clean up the set** — remove the symbol from `_trailing_sl_placed` when the position closes or when trailing deactivates.

### Priority: High — affects trade analytics accuracy and makes it impossible to evaluate trailing stop performance.

---

## T3 — Phase 3 Backup Close Fires on Broken State (Medium)

### Symptoms

- Log message: `"Trailing stop close failed for {sym}: No open position for {sym}"`
- Repeated error spam every 10 seconds for positions that were already closed
- Phase 3 only fires when Phase 1+2 worked correctly (placed SL) but the SL already triggered

### Root Cause

Phase 3 of the trailing stop (`daemon.py:1959-2006`) is a "backup" mechanism: after Phase 2 places a trailing SL trigger order, Phase 3 **also** checks if the current price has breached the trailing stop level and tries to `market_close()` the position directly.

The problem: Phase 2's SL trigger order fires inside `check_triggers()` at the TOP of `_fast_trigger_check()` (line 1770). This closes the position internally in the paper provider. But Phase 3 runs LATER in the same function (line 1959), after `check_triggers()` has already closed the position. So Phase 3 tries to `market_close()` a position that no longer exists.

Additionally, if `_prev_positions` is stale (see T1), Phase 3 keeps firing on every tick because it still thinks the position is open.

```
_fast_trigger_check():
  1. check_triggers()       → trailing SL fires, position closed internally
  2. get_user_state()       → fails (429) or succeeds (but Phase 3 already running)
  3. ROE tracking loop      → computes ROE on stale data
  4. Breakeven logic        → runs on stale data
  5. Trailing Phase 1 & 2   → recalculates trailing (no-ops if already set)
  6. Trailing Phase 3       → tries market_close() → CRASH: position already gone
```

**Key files:**
- `src/hynous/intelligence/daemon.py:1959-2006` — Phase 3 backup close
- `src/hynous/intelligence/daemon.py:1770` — `check_triggers()` already handles the SL

### Fix

**Keep Phase 3 — it is a legitimate Phase 2 failure backup.** Original analysis incorrectly flagged it as dead code.

Phase 3 is needed when Phase 2's `place_trigger_order()` fails after `cancel_order()` already cleared `pos.sl_px`. In this case:
- `pos.sl_px` is None — `check_triggers()` won't fire any SL
- `_trailing_stop_px[sym]` holds the correct trail price (set before the try block on line 1934)
- Phase 3 is the only mechanism that detects the trail level breach and closes the position

The spurious `"Trailing stop close failed"` warning (when `check_triggers()` already closed the position) is resolved by Fix 01's event-based eviction: closed coins are removed from `_prev_positions`, so the ROE loop's `if not pos: continue` guard (line 1806) skips Phase 3 for already-closed positions.

### Priority: Resolved — no separate fix needed. Fix 01's event-based eviction makes Phase 3 safe.

---

## B1 — Stale Trigger Cache Causes Breakeven to Overwrite Tighter SL (High)

### Symptoms

- Agent places a tight SL (e.g., -1.5% from entry), then breakeven logic overwrites it with a wider SL at entry + 0.07% buffer
- Effectively removes the agent's risk management
- Only happens when the agent's SL placement and the breakeven check happen within the same trigger cache refresh window

### Root Cause

The breakeven logic (`daemon.py:1824-1886`) checks whether the position already has a "good enough" SL by reading from `_tracked_triggers` — a cached copy of all trigger orders. This cache is refreshed by `_refresh_trigger_cache()` (`daemon.py:1733-1748`), which runs:

- At daemon startup
- After `_poll_derivatives()` (every 300 seconds)
- After trailing stop updates
- After position closes

**Critically, `_refresh_trigger_cache()` is NOT called after the agent places or modifies a trade.** So if the agent places a position with a tight SL at t=0, and `_tracked_triggers` was last refreshed at t=-200s, the breakeven logic at t=10s will see the OLD cached triggers (which don't include the agent's SL). It will conclude "no SL exists" and place a breakeven SL — overwriting the agent's tighter SL.

The `has_good_sl` check (`daemon.py:1842-1855`) looks through `_tracked_triggers` for any SL on the position. If the cache is stale and doesn't contain the agent's recently-placed SL, `has_good_sl` is False, and breakeven proceeds to place its own SL.

```
t=0:     Agent opens position with SL at -1.5%
t=10:    _fast_trigger_check() runs
         → _tracked_triggers is stale (from 200s ago, doesn't have agent's SL)
         → breakeven check: has_good_sl = False
         → places breakeven SL at entry + 0.07%
         → paper.place_trigger_order() OVERWRITES agent's -1.5% SL with breakeven SL
t=300:   _refresh_trigger_cache() finally runs, but damage is done
```

**Key files:**
- `src/hynous/intelligence/daemon.py:1733-1748` — `_refresh_trigger_cache()` and when it's called
- `src/hynous/intelligence/daemon.py:1824-1886` — breakeven logic using stale `_tracked_triggers`
- `src/hynous/data/providers/paper.py:454-476` — `place_trigger_order()` overwrites `pos.sl_px`

### Fix

1. **Refresh trigger cache after agent trades** — in `_check_positions()` when a new position is detected (i.e., a new symbol appears in `_prev_positions`), call `_refresh_trigger_cache()` immediately.
2. **Compare SL prices, not just existence** — the breakeven logic should check if the existing SL is already tighter than the breakeven price. If the existing SL is tighter (closer to entry), skip the breakeven placement. This prevents overwriting tighter SLs even with a fresh cache.
3. **Read live trigger state instead of cache for breakeven** — call `get_trigger_orders()` directly in the breakeven block rather than relying on the cached `_tracked_triggers`.

Fix #2 alone would solve the symptom, but fix #1 addresses the root cause of stale caches.

### Priority: High — silently removes agent's risk management, can lead to larger losses than intended.

---

## B2 — Breakeven Exits Misclassified as "stop_loss" (Medium)

### Symptoms

- Journal entries show breakeven closes as regular "stop_loss"
- Cannot distinguish breakeven exits from actual stop losses in analytics
- Same root cause as T2 but for breakeven

### Root Cause

Identical to T2. The breakeven logic places a standard SL trigger order via `place_trigger_order()`. When `check_triggers()` fires it, the event reason is `"stop_loss"`. There's no mechanism to tag it as a breakeven exit.

**Key files:**
- Same as T2: `paper.py:555-625`, `daemon.py:2299-2386`, `daemon.py:2505-2537`

### Fix

Same pattern as T2:

1. **Track breakeven SLs** — when the breakeven block places an SL, add the symbol to `_breakeven_sl_placed: set[str]`.
2. **In `_handle_position_close()`** — if fill reason is `"stop_loss"` and symbol is in `_breakeven_sl_placed`, classify as `"breakeven_stop"`.
3. **Priority order** — trailing stop classification takes precedence over breakeven (if both flags are set, it's a trailing stop since trailing replaces breakeven).

### Priority: Medium — analytics accuracy issue, no impact on actual trading.

---

## B3 — Breakeven Doesn't Cancel Old SL Before Placing New One (Low)

### Symptoms

- In paper trading: no visible symptom because `place_trigger_order()` overwrites `pos.sl_px` directly
- In live trading (Hyperliquid): would create duplicate SL orders, with unpredictable behavior

### Root Cause

The breakeven block (`daemon.py:1860-1886`) calls `place_trigger_order()` to set the breakeven SL but never calls `cancel_order()` on the existing SL first.

In the paper provider, this is benign: `place_trigger_order()` (`paper.py:454-476`) simply sets `pos.sl_px = trigger_px`, overwriting any previous value. There's no order book — just a single price field.

However, the trailing stop code (`daemon.py:1920-1940`) correctly cancels the old SL before placing the new one:
```python
# Trailing stop (correct pattern):
for oid in old_sl_oids:
    await provider.cancel_order(sym, oid)
await provider.place_trigger_order(...)
```

The breakeven code skips this step:
```python
# Breakeven (missing cancel):
await provider.place_trigger_order(...)   # no cancel_order() first
```

If the project ever switches from paper to live Hyperliquid trading, this would create duplicate SL orders on the exchange.

**Key files:**
- `src/hynous/intelligence/daemon.py:1860-1886` — breakeven placement without cancel
- `src/hynous/intelligence/daemon.py:1920-1940` — trailing stop correctly cancels first
- `src/hynous/data/providers/paper.py:454-476` — `place_trigger_order()` overwrites (masks the bug)

### Fix

Add the same cancel-before-place pattern used by trailing stops:

```python
# Before placing breakeven SL:
for trig in self._tracked_triggers:
    if trig["coin"] == sym and trig.get("orderType") == "Stop Market" and trig["side"] != pos_side:
        await provider.cancel_order(sym, trig["oid"])
await provider.place_trigger_order(...)
```

### Priority: Low — no impact in paper trading, but should be fixed before live trading.

---

## S1 — Hyperliquid 429 Rate Limiting Cascades (High)

### Symptoms

- Bursts of errors across all daemon systems simultaneously
- `get_all_prices()` failures propagate to: position checks, trigger checks, candle fetches, price displays
- System recovers after rate limit window passes, but all position management is blind during the outage

### Root Cause

`get_all_prices()` in `hyperliquid.py:597-604` calls `self._info.all_mids()` with **no exception handling, no retry, no backoff**:

```python
def get_all_prices(self) -> dict[str, float]:
    raw = self._info.all_mids()
    return {k: float(v) for k, v in raw.items()}
```

When Hyperliquid returns HTTP 429 (rate limit), the SDK raises an exception. This exception propagates to every caller:

- `_fast_trigger_check()` → fails entirely, skips all SL/TP/trailing/breakeven checks
- `_check_positions()` → fails, `_prev_positions` not updated
- `_update_peaks_from_candles()` → fails, MFE/MAE tracking gaps
- `check_triggers()` in paper provider → fails, SL/TP not evaluated

The daemon calls `get_all_prices()` or price-dependent methods many times per tick cycle. Each call is independent and each can trigger a 429. The lack of any rate-limiting awareness means the daemon can burn through the rate limit budget quickly during busy periods.

**Key files:**
- `src/hynous/data/providers/hyperliquid.py:597-604` — `get_all_prices()` with no error handling
- `src/hynous/data/providers/paper.py:154-189` — `get_user_state()` calling `get_all_prices()`
- `src/hynous/intelligence/daemon.py:1750-1798` — `_fast_trigger_check()` calling both

### Fix

1. **Add retry with backoff to `get_all_prices()`** — catch HTTP 429, wait 1-2 seconds, retry once. If second attempt fails, raise.
2. **Cache `all_mids` with short TTL** — prices don't change meaningfully within 1-2 seconds. Cache the result for ~2s so multiple callers in the same tick cycle share one HTTP call.
3. **Add try/except to each daemon method that calls price-dependent code** — don't let a single 429 skip all checks. Isolate failures so that e.g. a failed candle fetch doesn't prevent trigger checking.

### Priority: High — 429s make the entire daemon blind to position management for the duration of the rate limit window.

---

## Implementation Order

| Priority | Bug | Effort | Impact |
|----------|-----|--------|--------|
| 1 | T1 — Stale position cache | Small | Fixes ghost position management + makes Phase 3 safe |
| 2 | T3 — Phase 3 backup close | — | **Resolved by T1** — event-based eviction makes Phase 3 safe; no deletion needed |
| 3 | B1 — Stale trigger cache | Small | Fixes breakeven overwriting agent SL |
| 4 | S1 — 429 rate limiting | Medium | Fixes cascading failures across all systems |
| 5 | T2 — Trailing misclassification | Small | Fixes trade analytics |
| 6 | B2 — Breakeven misclassification | Small | Fixes trade analytics |
| 7 | B3 — Missing cancel before place | Trivial | Prep for live trading |

Recommended approach: fix T1 first (also resolves T3), then B1, then S1, then T2 + B2 + B3.

---

## Code Reference Summary

| File | Lines | What |
|------|-------|------|
| `src/hynous/intelligence/daemon.py` | 320-365 | State dictionaries (`_prev_positions`, `_trailing_active`, `_breakeven_set`, etc.) |
| `src/hynous/intelligence/daemon.py` | 1733-1748 | `_refresh_trigger_cache()` |
| `src/hynous/intelligence/daemon.py` | 1750-1798 | `_fast_trigger_check()` — trigger eval + position refresh |
| `src/hynous/intelligence/daemon.py` | 1800-1822 | ROE tracking loop |
| `src/hynous/intelligence/daemon.py` | 1824-1886 | Breakeven stop logic |
| `src/hynous/intelligence/daemon.py` | 1888-1957 | Trailing stop Phase 1 & 2 |
| `src/hynous/intelligence/daemon.py` | 1959-2006 | Trailing stop Phase 3 (KEPT — Phase 2 failure backup) |
| `src/hynous/intelligence/daemon.py` | 2008-2060 | Small wins mode |
| `src/hynous/intelligence/daemon.py` | 2067-2131 | `_update_peaks_from_candles()` |
| `src/hynous/intelligence/daemon.py` | 2203-2297 | `_check_positions()` |
| `src/hynous/intelligence/daemon.py` | 2299-2386 | `_handle_position_close()` |
| `src/hynous/intelligence/daemon.py` | 2505-2537 | `_classify_fill()` |
| `src/hynous/intelligence/daemon.py` | 2744-2773 | `_check_profit_levels()` cleanup |
| `src/hynous/data/providers/paper.py` | 154-189 | `get_user_state()` |
| `src/hynous/data/providers/paper.py` | 302-351 | `market_close()` |
| `src/hynous/data/providers/paper.py` | 454-476 | `place_trigger_order()` |
| `src/hynous/data/providers/paper.py` | 555-625 | `check_triggers()` |
| `src/hynous/data/providers/hyperliquid.py` | 597-604 | `get_all_prices()` — no error handling |
| `src/hynous/intelligence/tools/trading.py` | 1770-1797 | Stop-tightening lockout (agent only) |
| `src/hynous/core/trading_settings.py` | 100-104 | Trailing stop settings |

---

Last updated: 2026-03-06
