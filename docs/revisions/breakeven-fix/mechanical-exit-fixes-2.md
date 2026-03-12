# Mechanical Exit System — Bug Fixes Round 2

> **Status:** Ready for implementation
> **Priority:** High — Bug A can leave positions with no SL; Bugs B/C cause ghost state that closes new positions on restart
> **Branch:** `test-env`
> **Files touched:** `src/hynous/intelligence/daemon.py`, `src/hynous/core/config.py`, `src/hynous/intelligence/scanner.py`

---

## Required Reading Before Starting

Read ALL of these before writing a single line of code. Do not skip any.

1. **`CLAUDE.md`** (project root) — codebase conventions, testing instructions (`PYTHONPATH=src pytest tests/`)
2. **`docs/revisions/breakeven-fix/README.md`** — two-layer breakeven design; you are fixing bugs on top of this already-implemented system
3. **`docs/revisions/breakeven-fix/trailing-stop-fixes.md`** — the three bugs fixed in Round 1; understand what is already fixed before touching anything
4. **`src/hynous/intelligence/daemon.py`** — read specifically:
   - `__init__` state dicts (lines ~334–342) — `_trailing_active`, `_trailing_stop_px`, `_peak_roe`, `_breakeven_set`, `_capital_be_set`
   - `_fast_trigger_check()` (lines ~1980–2440) — the 1s loop; contains ALL mechanical exit logic
   - `_check_profit_levels()` (lines ~3017–3226) — the 60s loop; cleanup, side-flip detection, profit alerts
   - `_update_peaks_from_candles()` (lines ~2442–2547) — candle-based MFE/MAE tracking
   - `_override_sl_classification()` (lines ~2968–2983) — converts "stop_loss" to specific exit type
   - `_persist_mechanical_state()` and `_load_mechanical_state()` (lines ~4365–4427) — disk persistence for trailing state
   - Capital-BE block (lines ~2072–2143) and fee-BE block (lines ~2145–2227) — study their rollback pattern; Bug A copies it
5. **`src/hynous/core/config.py`** — `DaemonConfig` dataclass (lines ~94–139) and `load_config()` (lines ~241–399); you will add fields to both
6. **`src/hynous/core/trading_settings.py`** — `TradingSettings` dataclass; `taker_fee_pct` already lives here; the daemon will read it from here after Bug H
7. **`src/hynous/intelligence/scanner.py`** — `_detect_peak_reversion()` (line ~1203); one taker_fee_pct usage to update
8. **`tests/unit/test_breakeven_fix.py`** — the test pattern this project uses; all new tests must follow this exact style (static source inspection with `_daemon_source()`, no daemon instantiation)

---

## System Context — What You Must Understand Before Touching Code

### The 1s / 60s loop split

`_loop_inner()` runs every 1 second. Every iteration calls `_fast_trigger_check()`. Every 60 seconds it calls `_check_positions()` and `_check_profit_levels()`. This means:

- `_fast_trigger_check()` is the hot path: it handles all mechanical exits (BE, trail), processes `check_triggers()` events, and updates `_peak_roe`.
- `_check_profit_levels()` is the slow path: it sends profit alerts and does state cleanup for closed positions.
- If a position closes in `_fast_trigger_check()`, the cleanup in `_check_profit_levels()` won't run for up to **60 seconds**.

### The persistence model

`_persist_mechanical_state()` writes `_peak_roe`, `_trailing_active`, and `_trailing_stop_px` to `storage/mechanical_state.json`. `_load_mechanical_state()` restores them on startup, filtered to only coins with currently open positions.

**Key invariant:** Any time these three dicts are mutated in a way that affects safety (activation, price change, or deletion due to close), `_persist_mechanical_state()` must be called before the process could restart. If it isn't, the file is stale.

### The ghost-state attack

If `_trailing_active["BTC"] = True` and `_trailing_stop_px["BTC"] = $100` exist in the file after a position closes, and the daemon restarts while a NEW BTC position is open, `_load_mechanical_state()` will load that stale state into the new position. Phase 3 will then evaluate `px >= $100` against a new position's price — potentially closing it immediately.

### The cancel-before-place contract

Phase 2 cancels the existing SL before placing the new trail SL. If `place_trigger_order()` fails after `cancel_order()` succeeds, the position has **no SL**. The capital-BE and fee-BE blocks both have a rollback that restores the old SL if placement fails. The trailing stop Phase 2 has never had this rollback. Bug A adds it.

### taker_fee_pct lives in three places (pre-fix)

`DaemonConfig.taker_fee_pct = 0.07`, `ScannerConfig.taker_fee_pct = 0.07`, and `TradingSettings.taker_fee_pct = 0.07`. All three are hardcoded to the same value. The daemon uses `self.config.daemon.taker_fee_pct` for fee-BE math and the trailing floor. Bug H removes it from both config classes and makes the daemon and scanner read from `TradingSettings` — consistent with how `trailing_activation_roe` and `trailing_retracement_pct` already work.

---

## Bug A — No Rollback When Trail SL Placement Fails

### Root cause

Phase 2 cancels the old SL and places a new trail SL. If `place_trigger_order()` throws a non-zombie exception (network, rate limit, etc.), the old SL is gone and no new SL was placed. The exception handler only logs a warning — no restore attempt. Position has zero SL protection.

The capital-BE block (lines 2096–2100 and 2127–2143) and fee-BE block (lines 2178–2183 and 2211–2227) both save `old_sl_info` before cancelling and restore it on failure. Phase 2 never received this treatment.

### Current code (lines 2275–2317)

```python
                            if should_update:
                                # Update the paper provider's SL to match.
                                # NOTE: _trailing_stop_px is updated INSIDE the try block, only
                                # after successful placement. This prevents a silent state gap
                                # where the code believes a SL is placed when it is not.
                                try:
                                    # Cancel existing SL first, then place new one
                                    triggers = self._tracked_triggers.get(sym, [])
                                    for t in triggers:
                                        if t.get("order_type") == "stop_loss" and t.get("oid"):
                                            self._get_provider().cancel_order(sym, t["oid"])
                                    self._get_provider().place_trigger_order(
                                        symbol=sym,
                                        is_buy=(side != "long"),
                                        sz=pos.get("size", 0),
                                        trigger_px=new_trail_px,
                                        tpsl="sl",
                                    )
                                    # Refresh trigger cache so check_triggers sees the new SL
                                    self._refresh_trigger_cache()
                                    # Update in-memory state AFTER confirmed successful placement
                                    self._trailing_stop_px[sym] = new_trail_px
                                    self._persist_mechanical_state()
                                    if old_trail_px > 0:
                                        logger.info(
                                            "Trailing stop UPDATED: %s %s | $%,.2f → $%,.2f (peak ROE %.1f%%, trail ROE %.1f%%)",
                                            sym, side, old_trail_px, new_trail_px, peak, trail_roe,
                                        )
                                except Exception as trail_err:
                                    _err = str(trail_err).lower()
                                    if "no position" in _err or "no open position" in _err:
                                        # Position already closed — evict stale zombie state immediately
                                        # rather than waiting up to 60s for _check_positions() cleanup
                                        logger.warning(
                                            "Trailing stop update: position gone for %s, clearing zombie state",
                                            sym,
                                        )
                                        self._prev_positions.pop(sym, None)
                                        self._trailing_active.pop(sym, None)
                                        self._trailing_stop_px.pop(sym, None)
                                        self._peak_roe.pop(sym, None)
                                    else:
                                        logger.warning("Trailing stop update failed for %s: %s", sym, trail_err)
```

### Replacement code

Replace the entire `if should_update:` block above with this:

```python
                            if should_update:
                                # Update the paper provider's SL to match.
                                # NOTE: _trailing_stop_px is updated INSIDE the try block, only
                                # after successful placement. This prevents a silent state gap
                                # where the code believes a SL is placed when it is not.
                                #
                                # Save old SL before cancel — required for rollback if placement fails.
                                # Mirrors the same pattern used in capital-BE and fee-BE blocks above.
                                triggers = self._tracked_triggers.get(sym, [])
                                old_sl_info = None
                                for t in triggers:
                                    if t.get("order_type") == "stop_loss" and t.get("oid"):
                                        old_sl_info = (t["oid"], t.get("trigger_px"))
                                        break

                                try:
                                    # Cancel existing SL first, then place new one
                                    for t in triggers:
                                        if t.get("order_type") == "stop_loss" and t.get("oid"):
                                            self._get_provider().cancel_order(sym, t["oid"])
                                    self._get_provider().place_trigger_order(
                                        symbol=sym,
                                        is_buy=(side != "long"),
                                        sz=pos.get("size", 0),
                                        trigger_px=new_trail_px,
                                        tpsl="sl",
                                    )
                                    # Refresh trigger cache so check_triggers sees the new SL
                                    self._refresh_trigger_cache()
                                    # Update in-memory state AFTER confirmed successful placement
                                    self._trailing_stop_px[sym] = new_trail_px
                                    self._persist_mechanical_state()
                                    if old_trail_px > 0:
                                        logger.info(
                                            "Trailing stop UPDATED: %s %s | $%,.2f → $%,.2f (peak ROE %.1f%%, trail ROE %.1f%%)",
                                            sym, side, old_trail_px, new_trail_px, peak, trail_roe,
                                        )
                                except Exception as trail_err:
                                    _err = str(trail_err).lower()
                                    if "no position" in _err or "no open position" in _err:
                                        # Position already closed — evict stale zombie state immediately
                                        # rather than waiting up to 60s for _check_positions() cleanup
                                        logger.warning(
                                            "Trailing stop update: position gone for %s, clearing zombie state",
                                            sym,
                                        )
                                        self._prev_positions.pop(sym, None)
                                        self._trailing_active.pop(sym, None)
                                        self._trailing_stop_px.pop(sym, None)
                                        self._peak_roe.pop(sym, None)
                                    else:
                                        logger.warning("Trailing stop update failed for %s: %s", sym, trail_err)
                                        # Rollback: restore old SL so position isn't left naked.
                                        # Cancel already succeeded — without this, there is zero SL protection.
                                        if old_sl_info:
                                            try:
                                                self._get_provider().place_trigger_order(
                                                    symbol=sym,
                                                    is_buy=(side != "long"),
                                                    sz=pos.get("size", 0),
                                                    trigger_px=old_sl_info[1],
                                                    tpsl="sl",
                                                )
                                                self._refresh_trigger_cache()
                                            except Exception:
                                                logger.error(
                                                    "CRITICAL: Failed to restore old SL for %s after trail update failure",
                                                    sym,
                                                )
```

**What changed:** `triggers` and `old_sl_info` are now saved **before** the `try:` block. The `else:` branch now has a rollback that restores the old SL if placement fails. The `triggers` variable inside the try block now references the pre-fetched list (the cancel loop works identically, just using the already-fetched list).

---

## Bug B — `check_triggers()` Close Path Leaves Ghost State in File

### Root cause

When `check_triggers()` fires inside `_fast_trigger_check()` and returns events (exchange SL/TP triggered), the code correctly evicts the closed coin from `_prev_positions`. But it does **not** clear `_trailing_active`, `_trailing_stop_px`, or `_peak_roe` for the closed coin, and does **not** call `_persist_mechanical_state()`.

`_check_profit_levels()` runs 60s later and cleans these from memory. But it also never calls `_persist_mechanical_state()` (Bug C's cleanup loop, covered separately). So `mechanical_state.json` retains stale trailing state for up to 60s — or indefinitely if `_check_profit_levels()` cleanup also doesn't persist.

The attack: agent enters a new position in the same coin within that 60s window, daemon restarts → ghost state loaded for the new position → Phase 3 fires immediately.

### Current code (lines 2022–2041)

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

### Replacement code

Replace the `if events:` block above with this:

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
                # Clear trailing stop state for closed coins and persist immediately.
                # Without this, mechanical_state.json retains ghost data. A new same-coin
                # position opened before _check_profit_levels() runs (up to 60s away) would
                # inherit stale trailing_active=True and a wrong trail price on restart.
                _closed_coins = {event["coin"] for event in events}
                for _coin in _closed_coins:
                    self._trailing_active.pop(_coin, None)
                    self._trailing_stop_px.pop(_coin, None)
                    self._peak_roe.pop(_coin, None)
                self._persist_mechanical_state()
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

**What changed:** After the `_prev_positions.pop()` loop and before the `get_user_state()` try block, iterate the closed coins and pop `_trailing_active`, `_trailing_stop_px`, and `_peak_roe`, then call `_persist_mechanical_state()`.

---

## Bug C — Side-Flip Cleanup Doesn't Persist

### Root cause

In `_check_profit_levels()`, when a position's side changes (e.g., long closes, short opens in same coin), lines 3139–3148 correctly pop `_trailing_active[coin]` and `_trailing_stop_px[coin]` from memory. There is no `_persist_mechanical_state()` call after this.

If the daemon restarts after the side-flip pop but before the next `_persist_mechanical_state()` call from Phase 2, `_load_mechanical_state()` restores the old (now-wrong-direction) trailing state onto the new position. Phase 3 will evaluate a long's trailing floor against a short position and may fire immediately.

### Current code (lines 3137–3149)

```python
                # Reset alerts if position side flipped (close long → open short)
                prev_side = self._profit_sides.get(coin)
                if prev_side and prev_side != side:
                    self._profit_alerts.pop(coin, None)
                    self._breakeven_set.pop(coin, None)         # New position — re-evaluate breakeven
                    self._capital_be_set.pop(coin, None)        # New position — re-evaluate capital-BE
                    self._small_wins_exited.pop(coin, None)    # New hold — re-arm small wins
                    self._small_wins_tp_placed.pop(coin, None) # New hold — re-arm TP order
                    self._peak_roe.pop(coin, None)             # New hold — reset MFE
                    self._trough_roe.pop(coin, None)           # New hold — reset MAE
                    self._trailing_active.pop(coin, None)      # New hold — re-arm trailing
                    self._trailing_stop_px.pop(coin, None)     # New hold — clear trail price
                self._profit_sides[coin] = side
```

### Replacement code

Replace the block above with this:

```python
                # Reset alerts if position side flipped (close long → open short)
                prev_side = self._profit_sides.get(coin)
                if prev_side and prev_side != side:
                    self._profit_alerts.pop(coin, None)
                    self._breakeven_set.pop(coin, None)         # New position — re-evaluate breakeven
                    self._capital_be_set.pop(coin, None)        # New position — re-evaluate capital-BE
                    self._small_wins_exited.pop(coin, None)    # New hold — re-arm small wins
                    self._small_wins_tp_placed.pop(coin, None) # New hold — re-arm TP order
                    self._peak_roe.pop(coin, None)             # New hold — reset MFE
                    self._trough_roe.pop(coin, None)           # New hold — reset MAE
                    self._trailing_active.pop(coin, None)      # New hold — re-arm trailing
                    self._trailing_stop_px.pop(coin, None)     # New hold — clear trail price
                    # Persist immediately: the old position's trail state is now invalid for the
                    # new position. Without this, a restart before the next Phase 2 persist call
                    # would load the wrong-direction trail price onto the new position.
                    self._persist_mechanical_state()
                self._profit_sides[coin] = side
```

**What changed:** One line added — `self._persist_mechanical_state()` at the end of the side-flip `if` block.

---

## Bug D — `_check_profit_levels()` Cleanup Loop Doesn't Persist

### Root cause

The cleanup at the bottom of `_check_profit_levels()` (lines 3191–3223) deletes `_trailing_active[coin]` and `_trailing_stop_px[coin]` for any coin that is no longer in `open_coins`. This is the 60s safety net that catches closes detected via snapshot comparison or any path that Bug B doesn't cover. After all the cleanup loops complete, there is no `_persist_mechanical_state()` call.

This means the file can still contain trailing state for recently-closed positions after the 60s cleanup runs. Stale data stays in `mechanical_state.json` until the next Phase 1 or Phase 2 persist call (which only fires when an active trailing position moves).

### Current code (lines 3191–3226 — the cleanup section at the bottom of `_check_profit_levels()`)

```python
            # Clean up alerts + sides + peak ROE for closed positions
            open_coins = {p["coin"] for p in positions}
            for coin in list(self._profit_alerts.keys()):
                if coin not in open_coins:
                    del self._profit_alerts[coin]
                    self._profit_sides.pop(coin, None)
            for coin in list(self._peak_roe):
                if coin not in open_coins:
                    del self._peak_roe[coin]
            for coin in list(self._current_roe):
                if coin not in open_coins:
                    del self._current_roe[coin]
            for coin in list(self._breakeven_set):
                if coin not in open_coins:
                    del self._breakeven_set[coin]
            for coin in list(self._capital_be_set):
                if coin not in open_coins:
                    del self._capital_be_set[coin]
            for coin in list(self._small_wins_exited):
                if coin not in open_coins:
                    del self._small_wins_exited[coin]
            for coin in list(self._small_wins_tp_placed):
                if coin not in open_coins:
                    del self._small_wins_tp_placed[coin]
            for coin in list(self._trough_roe):
                if coin not in open_coins:
                    del self._trough_roe[coin]
            for coin in list(self._trailing_active):
                if coin not in open_coins:
                    del self._trailing_active[coin]
            for coin in list(self._trailing_stop_px):
                if coin not in open_coins:
                    del self._trailing_stop_px[coin]

        except Exception as e:
            logger.debug("Profit level check failed: %s", e)
```

### Replacement code

Replace only the final two `for coin in list(...)` loops and add the persist call after them:

```python
            for coin in list(self._trough_roe):
                if coin not in open_coins:
                    del self._trough_roe[coin]
            _cleaned_trailing = False
            for coin in list(self._trailing_active):
                if coin not in open_coins:
                    del self._trailing_active[coin]
                    _cleaned_trailing = True
            for coin in list(self._trailing_stop_px):
                if coin not in open_coins:
                    del self._trailing_stop_px[coin]
                    _cleaned_trailing = True
            if _cleaned_trailing:
                # Persist only when trailing state actually changed — prevents unnecessary
                # disk writes on every 60s cycle when no positions closed.
                self._persist_mechanical_state()

        except Exception as e:
            logger.debug("Profit level check failed: %s", e)
```

**What changed:** Added `_cleaned_trailing` tracking flag. When any trailing state is deleted, `_persist_mechanical_state()` is called once after both loops complete.

---

## Bug E — Phase 3 Success Path Doesn't Persist

### Root cause

When Phase 3 fires `market_close()` successfully, the success path pops `_trailing_active[sym]`, `_trailing_stop_px[sym]`, and `_peak_roe[sym]` from memory. There is no `_persist_mechanical_state()` call. `mechanical_state.json` retains the old values until the next Phase 1 or Phase 2 persist call for any other position.

`_load_mechanical_state()` filters state by currently open positions, so a brand-new same-coin position opened during that window and a subsequent daemon restart is the attack. Lower probability than Bug B (requires the specific timing of Phase 3 market_close + new entry + restart in a narrow window), but the fix is a single line.

### Current code (lines 2358–2367 — Phase 3 success path cleanup)

```python
                                        self._position_types.pop(sym, None)
                                        self._persist_position_types()
                                        self._prev_positions.pop(sym, None)
                                        self._trailing_active.pop(sym, None)
                                        self._trailing_stop_px.pop(sym, None)
                                        self._peak_roe.pop(sym, None)
                                        try:
                                            self._get_provider().cancel_all_orders(sym)
                                        except Exception:
                                            pass
```

### Replacement code

```python
                                        self._position_types.pop(sym, None)
                                        self._persist_position_types()
                                        self._prev_positions.pop(sym, None)
                                        self._trailing_active.pop(sym, None)
                                        self._trailing_stop_px.pop(sym, None)
                                        self._peak_roe.pop(sym, None)
                                        self._persist_mechanical_state()
                                        try:
                                            self._get_provider().cancel_all_orders(sym)
                                        except Exception:
                                            pass
```

**What changed:** One line — `self._persist_mechanical_state()` added after the pop block, before `cancel_all_orders`.

---

## Bug F — Candle Peak Tracking Doesn't Persist Updated `_peak_roe`

### Root cause

`_update_peaks_from_candles()` runs every 60s. When it detects a candle extreme higher than `_peak_roe[sym]`, it updates the dict. It does not call `_persist_mechanical_state()`. If trailing is active for that symbol and the daemon restarts in the < 1s window before Phase 2 processes the new peak, the persisted peak is slightly stale. The trail will compute a slightly lower new_trail_px for one iteration after restart.

Low probability and low impact (trail is slightly looser for one tick), but the fix is a two-line addition.

### Current code (lines 2488–2497 — the peak update section inside `_update_peaks_from_candles()`)

```python
                # Update peaks — only if candle extreme exceeds current record
                if best_roe > self._peak_roe.get(sym, 0):
                    old_peak = self._peak_roe.get(sym, 0)
                    self._peak_roe[sym] = best_roe
                    if best_roe - old_peak > 0.5:  # Only log significant corrections
                        logger.info(
                            "MFE corrected by candle: %s %s | %.1f%% → %.1f%% (+%.1f%%)",
                            sym, side, old_peak, best_roe, best_roe - old_peak,
                        )
```

### Replacement code

```python
                # Update peaks — only if candle extreme exceeds current record
                if best_roe > self._peak_roe.get(sym, 0):
                    old_peak = self._peak_roe.get(sym, 0)
                    self._peak_roe[sym] = best_roe
                    if best_roe - old_peak > 0.5:  # Only log significant corrections
                        logger.info(
                            "MFE corrected by candle: %s %s | %.1f%% → %.1f%% (+%.1f%%)",
                            sym, side, old_peak, best_roe, best_roe - old_peak,
                        )
                    # Persist if trailing is active — candle-updated peak feeds into trail
                    # price calculation. Without persist, a restart loses the candle correction.
                    if self._trailing_active.get(sym):
                        self._persist_mechanical_state()
```

**What changed:** Two lines added — the `if self._trailing_active.get(sym): self._persist_mechanical_state()` guard at the end of the peak-update block.

---

## Bug G — `_override_sl_classification()` Misclassifies When Trail SL Was Never Placed

### Root cause

`_override_sl_classification()` returns `"trailing_stop"` when `_trailing_active.get(coin)` is True. But `_trailing_active` is set in Phase 1, **before** Phase 2 attempts to place the trail SL. If Phase 1 fires and Phase 2 immediately fails (non-zombie exception), `_trailing_active` is True but `_trailing_stop_px` was never set (Fix 3 from Round 1 ensures no assignment on failure).

In this state, the breakeven SL on the exchange is the actual active protection. When it fires, the classification should be `"breakeven_stop"`. Instead it returns `"trailing_stop"`.

The correct check is: trailing stop is active AND the trail SL was actually placed (i.e., `_trailing_stop_px` has a value for this coin).

### Current code (lines 2977–2978 inside `_override_sl_classification()`)

```python
        if self._trailing_active.get(coin):
            return "trailing_stop"
```

### Replacement code

```python
        if self._trailing_active.get(coin) and self._trailing_stop_px.get(coin):
            return "trailing_stop"
```

**What changed:** One additional condition — `and self._trailing_stop_px.get(coin)`. Only classifies as trailing_stop when the trail SL was confirmed placed.

---

## Bug H — `taker_fee_pct` Duplicated Across Three Locations

### Why this is wrong

`DaemonConfig.taker_fee_pct = 0.07`, `ScannerConfig.taker_fee_pct = 0.07`, and `TradingSettings.taker_fee_pct = 0.07` all exist independently. The daemon and scanner hardcode `0.07` at import time. The Settings page only updates `TradingSettings`. If Hyperliquid changes your fee tier and you update the Settings page, the daemon's fee-BE calculations and trailing floor still use the old value.

The daemon already reads `trailing_activation_roe` and `trailing_retracement_pct` from `TradingSettings` at runtime via `ts = get_trading_settings()`. This fix applies the same pattern to `taker_fee_pct`.

### Five locations in `daemon.py` to update

All five are replacing `self.config.daemon.taker_fee_pct` with the local `TradingSettings` object that is already in scope.

**Location 1 — Line 2152 (fee-BE block)**

Current:
```python
                    fee_be_roe = self.config.daemon.taker_fee_pct * leverage
```

Replacement (no `ts` is in scope here — add a local call):
```python
                    fee_be_roe = get_trading_settings().taker_fee_pct * leverage
```

**Location 2 — Line 2258 (trailing stop Phase 2 floor)**

`ts` is already in scope from line 2237 (`ts = get_trading_settings()`).

Current:
```python
                            fee_be_roe = self.config.daemon.taker_fee_pct * leverage
```

Replacement:
```python
                            fee_be_roe = ts.taker_fee_pct * leverage
```

**Location 3 — Line 2386 (small wins exit in `_fast_trigger_check()`)**

`ts` is already in scope from line 2384 (`ts = get_trading_settings()`).

Current:
```python
                    fee_be_roe = self.config.daemon.taker_fee_pct * leverage
```

Replacement:
```python
                    fee_be_roe = ts.taker_fee_pct * leverage
```

**Location 4 — Line 3058 (small wins TP order in `_check_profit_levels()`)**

`ts_tp` is already in scope from line 3056 (`ts_tp = get_trading_settings()`).

Current:
```python
                        fee_be_tp = self.config.daemon.taker_fee_pct * leverage
```

Replacement:
```python
                        fee_be_tp = ts_tp.taker_fee_pct * leverage
```

**Location 5 — Line 3089 (small wins polling fallback in `_check_profit_levels()`)**

`ts_sw` is already in scope from line 3087 (`ts_sw = get_trading_settings()`).

Current:
```python
                        fee_be_roe_sw = self.config.daemon.taker_fee_pct * leverage
```

Replacement:
```python
                        fee_be_roe_sw = ts_sw.taker_fee_pct * leverage
```

### One location in `scanner.py` to update

**Line 1226 (`_detect_peak_reversion()`)**

The scanner already has a local import of `get_trading_settings` at line 1601 used elsewhere. The same pattern applies here.

Current:
```python
            fee_be_roe = self.config.taker_fee_pct * leverage
```

Replacement:
```python
            from ..core.trading_settings import get_trading_settings
            fee_be_roe = get_trading_settings().taker_fee_pct * leverage
```

Note: the `from ..core.trading_settings import get_trading_settings` line should be placed at the top of the `_detect_peak_reversion()` method, not inline on the same line. Add it as the first line of the method body (after the docstring and before `results = []`).

### Remove `taker_fee_pct` from `DaemonConfig` and `ScannerConfig`

**In `src/hynous/core/config.py`:**

Remove this line from `DaemonConfig` (currently line 131):
```python
    taker_fee_pct: float = 0.07                    # Round-trip taker fee as % of notional (drives fee BE calc)
```

Remove this line from `ScannerConfig` (currently line 173):
```python
    taker_fee_pct: float = 0.07                    # Round-trip taker fee % (for fee break-even gating)
```

Do **not** remove `taker_fee_pct` from `TradingSettings` — that is now the single source of truth.

### Bug I — `load_config()` Doesn't Wire Mechanical Exit Fields from YAML

This is documented separately but resolved in the same change. While you have `config.py` open to remove `taker_fee_pct`, also add the missing fields to the `DaemonConfig(...)` constructor call in `load_config()` (currently lines 310–330).

Add these fields to the `DaemonConfig(...)` call. Insert them after the existing `wake_cooldown_seconds=` line and before `phantom_check_interval=`:

```python
            breakeven_stop_enabled=daemon_raw.get("breakeven_stop_enabled", True),
            breakeven_buffer_micro_pct=daemon_raw.get("breakeven_buffer_micro_pct", 0.07),
            breakeven_buffer_macro_pct=daemon_raw.get("breakeven_buffer_macro_pct", 0.07),
            capital_breakeven_enabled=daemon_raw.get("capital_breakeven_enabled", True),
            capital_breakeven_roe=daemon_raw.get("capital_breakeven_roe", 0.5),
            trailing_stop_enabled=daemon_raw.get("trailing_stop_enabled", True),
            candle_peak_tracking_enabled=daemon_raw.get("candle_peak_tracking_enabled", True),
            peak_reversion_threshold_micro=daemon_raw.get("peak_reversion_threshold_micro", 0.40),
            peak_reversion_threshold_macro=daemon_raw.get("peak_reversion_threshold_macro", 0.50),
```

Also add to the `ScannerConfig(...)` call (currently lines 331–351). Insert after `news_wake_max_age_minutes=`:

```python
            peak_reversion_threshold_micro=scanner_raw.get("peak_reversion_threshold_micro", 0.40),
            peak_reversion_threshold_macro=scanner_raw.get("peak_reversion_threshold_macro", 0.50),
```

Do **not** add `taker_fee_pct` to either constructor call — it was removed from those dataclasses (Bug H).

Do **not** add `trailing_activation_roe` or `trailing_retracement_pct` to the `DaemonConfig(...)` call — these are already read from `TradingSettings` at runtime and the `DaemonConfig` versions are unused dead fields.

---

## Order of Changes

Apply exactly in this order. Test after each group before continuing.

### Group 1 — daemon.py mechanical fixes (Bugs A–F and G)

Apply all seven changes to `daemon.py`:
1. **Bug A** — Replace `if should_update:` block (Phase 2, ~lines 2275–2317)
2. **Bug B** — Insert trailing state cleanup + persist in `if events:` block (~lines 2022–2041)
3. **Bug C** — Add `_persist_mechanical_state()` at end of side-flip block (~line 3148)
4. **Bug D** — Add `_cleaned_trailing` flag and conditional persist to cleanup loops (~lines 3218–3223)
5. **Bug E** — Add `if _trailing_active: _persist_mechanical_state()` in candle peak update (~line 2496)
6. **Bug F** — Add `_persist_mechanical_state()` in Phase 3 success path (~line 2363)
7. **Bug G** — Add `and self._trailing_stop_px.get(coin)` to `_override_sl_classification()` (~line 2977)

Run tests:
```bash
PYTHONPATH=src pytest tests/unit/test_mechanical_exit_fixes_2.py -v
```

### Group 2 — config.py and scanner.py (Bugs H and I)

Apply to `src/hynous/core/config.py`:
1. Remove `taker_fee_pct` from `DaemonConfig` dataclass
2. Remove `taker_fee_pct` from `ScannerConfig` dataclass
3. Add missing fields to `DaemonConfig(...)` in `load_config()` (Bug I)
4. Add missing fields to `ScannerConfig(...)` in `load_config()` (Bug I)

Apply to `src/hynous/intelligence/scanner.py`:
1. Add `from ..core.trading_settings import get_trading_settings` at top of `_detect_peak_reversion()`
2. Replace `self.config.taker_fee_pct` with `get_trading_settings().taker_fee_pct`

Apply to `src/hynous/intelligence/daemon.py`:
1. Replace the 5 `self.config.daemon.taker_fee_pct` occurrences per Bug H instructions above

Run tests:
```bash
PYTHONPATH=src pytest tests/unit/test_mechanical_exit_fixes_2.py -v
PYTHONPATH=src pytest tests/unit/test_breakeven_fix.py -v
PYTHONPATH=src pytest tests/unit/ -v
```

---

## Tests

Create `tests/unit/test_mechanical_exit_fixes_2.py` with this content:

```python
"""Unit tests for mechanical exit bug fixes — Round 2.

Tests verify:
1. Bug A: Phase 2 trail SL update saves old_sl_info and restores it on placement failure
2. Bug B: check_triggers close path clears trailing state from memory and disk
3. Bug C: Side-flip clears and persists trailing state
4. Bug D: _check_profit_levels cleanup loop persists when trailing state is deleted
5. Bug E: Candle peak update persists when trailing is active
6. Bug F: Phase 3 success path persists after popping trailing state
7. Bug G: _override_sl_classification requires _trailing_stop_px to be set for "trailing_stop"
8. Bug H: taker_fee_pct removed from DaemonConfig and ScannerConfig
9. Bug I: load_config() wires mechanical exit fields from YAML
"""
import pytest
from pathlib import Path


# ── Source Helpers ────────────────────────────────────────────────────────────

def _daemon_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return path.read_text()


def _config_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "core" / "config.py"
    return path.read_text()


def _scanner_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "scanner.py"
    return path.read_text()


def _trading_settings_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "core" / "trading_settings.py"
    return path.read_text()


def _default_yaml() -> dict:
    import yaml
    path = Path(__file__).parent.parent.parent / "config" / "default.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def _fast_trigger_check_source() -> str:
    """Extract just the _fast_trigger_check method body from daemon.py."""
    source = _daemon_source()
    start = source.find("def _fast_trigger_check(")
    end = source.find("\n    def ", start + 1)
    return source[start:end]


def _check_profit_levels_source() -> str:
    """Extract just the _check_profit_levels method body from daemon.py."""
    source = _daemon_source()
    start = source.find("def _check_profit_levels(")
    end = source.find("\n    def ", start + 1)
    return source[start:end]


def _override_sl_source() -> str:
    """Extract just the _override_sl_classification method body from daemon.py."""
    source = _daemon_source()
    start = source.find("def _override_sl_classification(")
    end = source.find("\n    def ", start + 1)
    return source[start:end]


def _update_peaks_source() -> str:
    """Extract just the _update_peaks_from_candles method body from daemon.py."""
    source = _daemon_source()
    start = source.find("def _update_peaks_from_candles(")
    end = source.find("\n    def ", start + 1)
    return source[start:end]


def _load_config_source() -> str:
    """Extract just the load_config function body from config.py."""
    source = _config_source()
    start = source.find("def load_config(")
    return source[start:]


# ── Bug A: Phase 2 rollback ────────────────────────────────────────────────────

class TestBugATrailSLRollback:
    """Phase 2 must save old_sl_info before cancelling and restore it on failure."""

    def test_old_sl_info_saved_before_try_block(self):
        """old_sl_info must be assigned BEFORE the try: block in the should_update path.

        Pattern: old_sl_info = None ... for t in triggers: if order_type == stop_loss ...
        must appear before the try: that does cancel + place.
        This ensures rollback is possible even when cancel succeeds but place fails.
        """
        source = _fast_trigger_check_source()
        # Both old_sl_info assignment and the triggers lookup must exist
        assert "old_sl_info = None" in source, \
            "old_sl_info = None must exist in _fast_trigger_check Phase 2"
        assert "old_sl_info = (t[\"oid\"], t.get(\"trigger_px\"))" in source, \
            "old_sl_info must be assigned from trigger order before the try block"

    def test_rollback_restores_old_sl_on_non_zombie_failure(self):
        """The else branch of the Phase 2 exception handler must restore the old SL."""
        source = _fast_trigger_check_source()
        # The rollback must exist in the else branch
        assert "if old_sl_info:" in source, \
            "Rollback guard 'if old_sl_info:' must exist in Phase 2 exception handler"
        # Must log CRITICAL if rollback also fails
        assert "CRITICAL: Failed to restore old SL for %s after trail update failure" in source, \
            "CRITICAL log must exist for failed rollback in trail SL update"

    def test_triggers_fetched_before_try(self):
        """triggers = self._tracked_triggers.get(sym, []) must appear before try: in Phase 2.

        The pre-fetched triggers list is used for both the cancel loop and old_sl_info.
        """
        source = _fast_trigger_check_source()
        # Verify triggers is fetched and old_sl_info is set (which requires triggers to exist)
        # The pattern: triggers = self._tracked_triggers.get(sym, []) ... old_sl_info
        idx_triggers = source.find("triggers = self._tracked_triggers.get(sym, [])")
        idx_old_sl = source.find("old_sl_info = None")
        assert idx_triggers != -1, "triggers must be fetched in Phase 2"
        assert idx_old_sl != -1, "old_sl_info must be initialized in Phase 2"
        assert idx_triggers < idx_old_sl, \
            "triggers must be fetched before old_sl_info is set"

    def test_trail_sl_placement_failure_does_not_leave_naked(self):
        """Verify rollback exists in the same except block as the zombie handler.

        The else branch must handle restoration — zombie branch is separate.
        """
        source = _fast_trigger_check_source()
        # Both zombie cleanup and the non-zombie rollback must coexist
        assert "no position" in source, "Zombie check must still exist"
        assert "if old_sl_info:" in source, "Rollback must exist alongside zombie check"


# ── Bug B: check_triggers close path ──────────────────────────────────────────

class TestBugBCheckTriggersCleanup:
    """check_triggers close must clear trailing state from memory and persist."""

    def test_trailing_active_popped_in_events_block(self):
        """_trailing_active must be popped for closed coins in the events block."""
        source = _fast_trigger_check_source()
        # Find the events block
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 800]
        assert "_trailing_active.pop(" in events_block, \
            "_trailing_active must be popped in the if events: block of _fast_trigger_check"

    def test_trailing_stop_px_popped_in_events_block(self):
        """_trailing_stop_px must be popped for closed coins in the events block."""
        source = _fast_trigger_check_source()
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 800]
        assert "_trailing_stop_px.pop(" in events_block, \
            "_trailing_stop_px must be popped in the if events: block of _fast_trigger_check"

    def test_peak_roe_popped_in_events_block(self):
        """_peak_roe must be popped for closed coins in the events block."""
        source = _fast_trigger_check_source()
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 800]
        assert "_peak_roe.pop(" in events_block, \
            "_peak_roe must be popped in the if events: block of _fast_trigger_check"

    def test_persist_called_after_eviction_in_events_block(self):
        """_persist_mechanical_state must be called in the events block."""
        source = _fast_trigger_check_source()
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 800]
        assert "_persist_mechanical_state()" in events_block, \
            "_persist_mechanical_state must be called in the if events: block"

    def test_persist_called_before_get_user_state(self):
        """_persist_mechanical_state must be called before get_user_state() attempt.

        Order: pop _prev_positions → pop trailing state → persist → get_user_state.
        """
        source = _fast_trigger_check_source()
        events_block_start = source.find("if events:")
        events_block = source[events_block_start:events_block_start + 1200]
        idx_persist = events_block.find("_persist_mechanical_state()")
        idx_get_user_state = events_block.find("get_user_state()")
        assert idx_persist != -1, "_persist_mechanical_state must exist in events block"
        assert idx_get_user_state != -1, "get_user_state must exist in events block"
        assert idx_persist < idx_get_user_state, \
            "_persist_mechanical_state must be called before get_user_state() in events block"


# ── Bug C: Side-flip persists ──────────────────────────────────────────────────

class TestBugCSideFlipPersist:
    """Side-flip cleanup must call _persist_mechanical_state after popping trailing state."""

    def test_persist_called_in_side_flip_block(self):
        """_persist_mechanical_state must be called inside the side-flip if block."""
        source = _check_profit_levels_source()
        # Find the side flip detection block
        side_flip_start = source.find("prev_side and prev_side != side")
        assert side_flip_start != -1, "Side-flip detection must exist in _check_profit_levels"
        # Extract the if block (bounded by the closing `self._profit_sides[coin] = side` line)
        side_flip_block = source[side_flip_start:source.find("self._profit_sides[coin] = side", side_flip_start)]
        assert "_persist_mechanical_state()" in side_flip_block, \
            "_persist_mechanical_state must be called inside the side-flip if block"

    def test_persist_called_after_trailing_pops_in_side_flip(self):
        """_persist_mechanical_state must come AFTER the trailing state pops."""
        source = _check_profit_levels_source()
        side_flip_start = source.find("prev_side and prev_side != side")
        profit_sides_line = source.find("self._profit_sides[coin] = side", side_flip_start)
        side_flip_block = source[side_flip_start:profit_sides_line]
        idx_trailing_pop = side_flip_block.rfind("_trailing_stop_px.pop(")
        idx_persist = side_flip_block.find("_persist_mechanical_state()")
        assert idx_trailing_pop != -1, "_trailing_stop_px.pop must be in side-flip block"
        assert idx_persist != -1, "_persist_mechanical_state must be in side-flip block"
        assert idx_trailing_pop < idx_persist, \
            "_persist_mechanical_state must come after _trailing_stop_px.pop in side-flip"


# ── Bug D: _check_profit_levels cleanup loop ────────────────────────────────────

class TestBugDCleanupLoopPersist:
    """Cleanup loop must persist trailing state when coins are deleted."""

    def test_cleaned_trailing_flag_exists(self):
        """A tracking flag must exist to conditionally persist only when changes occur."""
        source = _check_profit_levels_source()
        assert "_cleaned_trailing" in source, \
            "_cleaned_trailing flag must exist in _check_profit_levels cleanup section"

    def test_persist_called_when_cleaned_trailing_true(self):
        """_persist_mechanical_state must be called conditionally after cleanup loops."""
        source = _check_profit_levels_source()
        # The pattern: if _cleaned_trailing: _persist_mechanical_state()
        assert "if _cleaned_trailing:" in source, \
            "Conditional persist guard 'if _cleaned_trailing:' must exist in cleanup section"
        idx_flag = source.find("if _cleaned_trailing:")
        idx_persist = source.find("_persist_mechanical_state()", idx_flag)
        assert idx_persist != -1 and idx_persist < idx_flag + 100, \
            "_persist_mechanical_state must immediately follow 'if _cleaned_trailing:'"

    def test_flag_set_in_trailing_active_loop(self):
        """_cleaned_trailing must be set True inside the _trailing_active cleanup loop."""
        source = _check_profit_levels_source()
        # Find trailing_active cleanup loop
        loop_start = source.find("for coin in list(self._trailing_active):")
        assert loop_start != -1, "_trailing_active cleanup loop must exist"
        loop_section = source[loop_start:loop_start + 200]
        assert "_cleaned_trailing = True" in loop_section, \
            "_cleaned_trailing = True must be set inside the _trailing_active cleanup loop"


# ── Bug E: Candle peak persist ─────────────────────────────────────────────────

class TestBugECandlePeakPersist:
    """_update_peaks_from_candles must persist when trailing is active and peak updates."""

    def test_persist_called_when_trailing_active(self):
        """_persist_mechanical_state must be called inside the peak update block when trailing active."""
        source = _update_peaks_source()
        # The pattern: if self._trailing_active.get(sym): self._persist_mechanical_state()
        assert "self._trailing_active.get(sym)" in source, \
            "Trailing active guard must exist in _update_peaks_from_candles"
        idx_trailing_guard = source.find("self._trailing_active.get(sym)")
        idx_persist = source.find("_persist_mechanical_state()", idx_trailing_guard)
        assert idx_persist != -1, \
            "_persist_mechanical_state must exist after trailing_active guard in candle tracking"

    def test_persist_only_when_trailing_active_not_unconditional(self):
        """_persist_mechanical_state must be guarded by _trailing_active check.

        Do not persist on every candle update — only when trailing is engaged.
        """
        source = _update_peaks_source()
        # The persist must be inside an 'if' block checking _trailing_active
        idx_guard = source.find("if self._trailing_active.get(sym):")
        assert idx_guard != -1, \
            "Conditional guard 'if self._trailing_active.get(sym):' must exist in candle tracking"


# ── Bug F: Phase 3 success persist ────────────────────────────────────────────

class TestBugFPhase3Persist:
    """Phase 3 success path must call _persist_mechanical_state after popping trailing state."""

    def test_persist_called_in_phase3_success(self):
        """_persist_mechanical_state must be called in Phase 3 success path.

        Specifically: after _peak_roe.pop(sym, None) and before cancel_all_orders.
        """
        source = _fast_trigger_check_source()
        # Find the Phase 3 success marker — the trailing stop hit message
        phase3_start = source.find("trail_msg = (")
        assert phase3_start != -1, "Phase 3 trail_msg must exist"
        # The cancel_all_orders call is the last thing in Phase 3 success
        cancel_all_start = source.find("cancel_all_orders(sym)", phase3_start)
        assert cancel_all_start != -1, "cancel_all_orders must exist in Phase 3"
        phase3_success = source[phase3_start:cancel_all_start + 50]
        assert "_persist_mechanical_state()" in phase3_success, \
            "_persist_mechanical_state must be called in Phase 3 success path"

    def test_persist_after_pop_before_cancel_all(self):
        """_persist_mechanical_state must come after _peak_roe.pop and before cancel_all_orders."""
        source = _fast_trigger_check_source()
        phase3_start = source.find("trail_msg = (")
        cancel_all_start = source.find("cancel_all_orders(sym)", phase3_start)
        phase3_section = source[phase3_start:cancel_all_start + 50]
        idx_peak_pop = phase3_section.rfind("_peak_roe.pop(")
        idx_persist = phase3_section.find("_persist_mechanical_state()")
        idx_cancel = phase3_section.find("cancel_all_orders(")
        assert idx_peak_pop < idx_persist < idx_cancel, \
            "Order must be: _peak_roe.pop → _persist_mechanical_state → cancel_all_orders"


# ── Bug G: Classification fix ──────────────────────────────────────────────────

class TestBugGClassificationFix:
    """_override_sl_classification must check _trailing_stop_px, not just _trailing_active."""

    def test_trailing_stop_classification_checks_stop_px(self):
        """trailing_stop classification must require _trailing_stop_px to be set."""
        source = _override_sl_source()
        # The correct pattern uses both _trailing_active and _trailing_stop_px
        assert "self._trailing_stop_px.get(coin)" in source, \
            "_override_sl_classification must check _trailing_stop_px not just _trailing_active"

    def test_trailing_stop_not_just_trailing_active(self):
        """Ensure the old single-check pattern is gone."""
        source = _override_sl_source()
        # The old incorrect pattern was: if self._trailing_active.get(coin): return "trailing_stop"
        # After fix it must include _trailing_stop_px
        trailing_check_idx = source.find("return \"trailing_stop\"")
        assert trailing_check_idx != -1, "trailing_stop classification must still exist"
        # Extract the condition line for trailing_stop
        line_start = source.rfind("\n", 0, trailing_check_idx)
        condition_line = source[line_start:trailing_check_idx + 30]
        assert "_trailing_stop_px" in condition_line, \
            "The line returning trailing_stop must reference _trailing_stop_px"


# ── Bug H: taker_fee_pct unified to TradingSettings ────────────────────────────

class TestBugHTakerFeePctUnified:
    """taker_fee_pct must be removed from DaemonConfig and ScannerConfig."""

    def test_taker_fee_pct_removed_from_daemon_config(self):
        """DaemonConfig must not have a taker_fee_pct field."""
        source = _config_source()
        # Find DaemonConfig class
        daemon_config_start = source.find("class DaemonConfig:")
        next_class = source.find("\n@dataclass\nclass ", daemon_config_start + 1)
        daemon_config_body = source[daemon_config_start:next_class]
        assert "taker_fee_pct" not in daemon_config_body, \
            "taker_fee_pct must be removed from DaemonConfig — use TradingSettings instead"

    def test_taker_fee_pct_removed_from_scanner_config(self):
        """ScannerConfig must not have a taker_fee_pct field."""
        source = _config_source()
        scanner_config_start = source.find("class ScannerConfig:")
        next_class = source.find("\n@dataclass\nclass ", scanner_config_start + 1)
        if next_class == -1:
            next_class = len(source)
        scanner_config_body = source[scanner_config_start:next_class]
        assert "taker_fee_pct" not in scanner_config_body, \
            "taker_fee_pct must be removed from ScannerConfig — use TradingSettings instead"

    def test_taker_fee_pct_remains_in_trading_settings(self):
        """taker_fee_pct must still exist in TradingSettings — the single source of truth."""
        source = _trading_settings_source()
        assert "taker_fee_pct: float = 0.07" in source, \
            "taker_fee_pct must remain in TradingSettings as the single source of truth"

    def test_daemon_does_not_use_config_daemon_taker_fee(self):
        """daemon.py must not reference self.config.daemon.taker_fee_pct anywhere."""
        source = _daemon_source()
        assert "self.config.daemon.taker_fee_pct" not in source, \
            "daemon.py must not use self.config.daemon.taker_fee_pct after Bug H fix"

    def test_scanner_does_not_use_config_taker_fee(self):
        """scanner.py must not reference self.config.taker_fee_pct anywhere."""
        source = _scanner_source()
        assert "self.config.taker_fee_pct" not in source, \
            "scanner.py must not use self.config.taker_fee_pct after Bug H fix"

    def test_daemon_uses_trading_settings_for_fee(self):
        """daemon.py must use get_trading_settings().taker_fee_pct or ts.taker_fee_pct."""
        source = _daemon_source()
        uses_ts = "ts.taker_fee_pct" in source or "ts_tp.taker_fee_pct" in source or "ts_sw.taker_fee_pct" in source
        uses_direct = "get_trading_settings().taker_fee_pct" in source
        assert uses_ts or uses_direct, \
            "daemon.py must read taker_fee_pct from TradingSettings (ts.taker_fee_pct or get_trading_settings().taker_fee_pct)"


# ── Bug I: load_config() wiring ────────────────────────────────────────────────

class TestBugILoadConfigWiring:
    """load_config() must pass all mechanical exit fields from YAML into DaemonConfig."""

    def test_breakeven_stop_enabled_wired(self):
        source = _load_config_source()
        assert "breakeven_stop_enabled" in source, \
            "breakeven_stop_enabled must be wired in load_config() DaemonConfig constructor"

    def test_breakeven_buffer_micro_wired(self):
        source = _load_config_source()
        assert "breakeven_buffer_micro_pct" in source, \
            "breakeven_buffer_micro_pct must be wired in load_config()"

    def test_breakeven_buffer_macro_wired(self):
        source = _load_config_source()
        assert "breakeven_buffer_macro_pct" in source, \
            "breakeven_buffer_macro_pct must be wired in load_config()"

    def test_capital_breakeven_enabled_wired(self):
        source = _load_config_source()
        assert "capital_breakeven_enabled" in source, \
            "capital_breakeven_enabled must be wired in load_config()"

    def test_capital_breakeven_roe_wired(self):
        source = _load_config_source()
        assert "capital_breakeven_roe" in source, \
            "capital_breakeven_roe must be wired in load_config()"

    def test_trailing_stop_enabled_wired(self):
        source = _load_config_source()
        assert "trailing_stop_enabled" in source, \
            "trailing_stop_enabled must be wired in load_config()"

    def test_candle_peak_tracking_enabled_wired(self):
        source = _load_config_source()
        assert "candle_peak_tracking_enabled" in source, \
            "candle_peak_tracking_enabled must be wired in load_config()"

    def test_peak_reversion_thresholds_wired(self):
        source = _load_config_source()
        assert "peak_reversion_threshold_micro" in source, \
            "peak_reversion_threshold_micro must be wired in load_config()"
        assert "peak_reversion_threshold_macro" in source, \
            "peak_reversion_threshold_macro must be wired in load_config()"

    def test_yaml_values_readable(self):
        """YAML values for all newly-wired fields must be parseable."""
        cfg = _default_yaml()
        daemon_cfg = cfg.get("daemon", {})
        assert daemon_cfg.get("capital_breakeven_enabled") is True
        assert daemon_cfg.get("capital_breakeven_roe") == 0.5
        assert daemon_cfg.get("trailing_stop_enabled") is True
        assert daemon_cfg.get("trailing_activation_roe") == 2.8
        assert daemon_cfg.get("candle_peak_tracking_enabled") is True
        assert daemon_cfg.get("breakeven_buffer_micro_pct") == 0.07

    def test_taker_fee_pct_not_wired_in_daemon_config_constructor(self):
        """taker_fee_pct must NOT be wired into DaemonConfig in load_config (it was removed)."""
        source = _load_config_source()
        # Find the DaemonConfig( constructor call in load_config
        daemon_constructor_start = source.find("daemon=DaemonConfig(")
        daemon_constructor_end = source.find("),\n        scanner=", daemon_constructor_start)
        daemon_constructor = source[daemon_constructor_start:daemon_constructor_end]
        assert "taker_fee_pct" not in daemon_constructor, \
            "taker_fee_pct must NOT appear in DaemonConfig constructor in load_config — field was removed"
```

---

## What NOT to Change

- `_persist_mechanical_state()` method body (lines 4365–4385) — do not touch; it is correct
- `_load_mechanical_state()` method body (lines 4387–4427) — do not touch; it is correct
- The capital-BE rollback pattern (lines 2127–2143) — do not modify; Bug A copies this exact pattern
- The fee-BE rollback pattern (lines 2211–2227) — same
- `TradingSettings.taker_fee_pct` (trading_settings.py) — do not remove; this becomes the single source of truth
- The three-bug fixes from Round 1 (zombie cleanup, persistence wiring, assignment-inside-try) — already applied, do not regress them
- `DaemonConfig.trailing_activation_roe` and `DaemonConfig.trailing_retracement_pct` — these are dead config fields (runtime reads from TradingSettings), leave them alone; do not wire them in `load_config()`

---

## VPS Validation After Deployment

SSH into the VPS and run these checks after deploying to confirm the fixes are live:

```bash
# 1. Confirm mechanical_state.json is created and has valid structure
cat storage/mechanical_state.json
# Expected: {"peak_roe": {...}, "trailing_stop_px": {...}, "trailing_active": {...}}

# 2. Confirm taker_fee_pct is no longer in the daemon config class
grep -n "taker_fee_pct" src/hynous/core/config.py
# Expected: zero matches (or only in comments)

# 3. Confirm daemon reads fee from trading_settings
grep -n "taker_fee_pct" src/hynous/intelligence/daemon.py
# Expected: lines with ts.taker_fee_pct, ts_tp.taker_fee_pct, ts_sw.taker_fee_pct, get_trading_settings().taker_fee_pct
# Zero matches for self.config.daemon.taker_fee_pct

# 4. Confirm old_sl_info exists in the trailing stop block
grep -n "old_sl_info" src/hynous/intelligence/daemon.py
# Expected: 3+ lines (initialization, assignment, and the rollback restore call)

# 5. Confirm _persist_mechanical_state is called in all new locations
grep -n "_persist_mechanical_state" src/hynous/intelligence/daemon.py
# Expected: 6+ calls (Phase 1, Phase 2, Phase 3/Bug F, Bug B events block, Bug C side-flip, Bug D cleanup)
# And in _update_peaks_from_candles (Bug E)

# 6. Check daemon logs after a paper trade closes
journalctl -u hynous -n 100 --no-pager | grep -E "(trailing|breakeven|persist)"
```

---

## Implementation Checklist

- [ ] Read all 8 required documents before starting
- [ ] **Bug A**: `old_sl_info` saved before try block; rollback in `else` branch with CRITICAL log on double-failure
- [ ] **Bug B**: `_closed_coins` set built from events; `_trailing_active`, `_trailing_stop_px`, `_peak_roe` popped; `_persist_mechanical_state()` called before `get_user_state()` try
- [ ] **Bug C**: `_persist_mechanical_state()` added inside side-flip `if` block, after the pop lines
- [ ] **Bug D**: `_cleaned_trailing` flag added; set `True` inside both trailing cleanup loops; `if _cleaned_trailing: _persist_mechanical_state()` after both loops
- [ ] **Bug E**: `if self._trailing_active.get(sym): self._persist_mechanical_state()` added inside the `if best_roe > self._peak_roe.get(sym, 0):` block
- [ ] **Bug F**: `self._persist_mechanical_state()` added after `_peak_roe.pop(sym, None)` in Phase 3 success path
- [ ] **Bug G**: `_override_sl_classification` condition changed to `and self._trailing_stop_px.get(coin)`
- [ ] **Bug H**: `taker_fee_pct` removed from `DaemonConfig` and `ScannerConfig`; all 5 daemon.py usages replaced with `ts.taker_fee_pct` / `ts_tp.taker_fee_pct` / `ts_sw.taker_fee_pct` / `get_trading_settings().taker_fee_pct`; scanner.py updated
- [ ] **Bug I**: 9 fields added to `DaemonConfig(...)` call in `load_config()`; 2 fields added to `ScannerConfig(...)` call
- [ ] Group 1 tests pass: `PYTHONPATH=src pytest tests/unit/test_mechanical_exit_fixes_2.py -v`
- [ ] Group 2 tests pass after config changes: `PYTHONPATH=src pytest tests/unit/ -v`
- [ ] Existing `test_breakeven_fix.py` still passes (no regressions)
- [ ] VPS validation grep checks all return expected output
- [ ] `docs/README.md` updated to reflect these fixes as implemented

---

Last updated: 2026-03-11
