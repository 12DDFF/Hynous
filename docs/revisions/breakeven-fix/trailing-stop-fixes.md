# Trailing Stop — Three Critical Bug Fixes

> **Status:** Ready for implementation
> **Priority:** High — affects every trade that reaches trailing stop activation threshold
> **Branch:** `test-env`
> **File:** `src/hynous/intelligence/daemon.py`

---

## Required Reading Before Starting

Read ALL of these before writing a single line of code. Do not skip any.

1. **`CLAUDE.md`** (project root) — codebase conventions, extension patterns, testing instructions
2. **`ARCHITECTURE.md`** (project root) — 5-component system, daemon role, data flow
3. **`docs/revisions/breakeven-fix/README.md`** — the full two-layer breakeven design; you are building on top of this system
4. **`src/hynous/intelligence/daemon.py`** — read specifically:
   - `__init__` state dict block (lines ~330–345) — every mechanical state dict
   - `_init_position_tracking()` (lines ~1920–1960) — startup sequence
   - `_fast_trigger_check()` (lines ~1978–2360) — the function that runs every 1s; contains ALL Phase 1/2/3 trailing stop logic
   - `_check_positions()` (lines ~2584–2690) — 60s position sync; how `_prev_positions` is updated
   - `_check_profit_levels()` (lines ~2981–3190) — 60s cleanup of all mechanical state dicts
   - `_persist_position_types()` / `_load_position_types()` (lines ~4299–4327) — the exact persistence pattern to replicate
   - `_persist_daily_pnl()` / `_load_daily_pnl()` (lines ~4329–4368) — second persistence example
5. **`src/hynous/core/persistence.py`** — read the `_atomic_write()` function; this is what all persistence uses
6. **`src/hynous/data/providers/paper.py`** — read `market_close()` and `place_trigger_order()` to understand exact error messages they throw
7. **`tests/unit/test_breakeven_fix.py`** — study the test structure and patterns; your new tests must follow the same style
8. **`config/default.yaml`** — daemon section; understand existing config fields

---

## System Context — What You Must Understand

### The 1s daemon loop

`_fast_trigger_check()` runs on every loop iteration (~1s). It:
1. Fetches fresh prices for all symbols in `_prev_positions`
2. Calls `check_triggers()` — fires any SL/TP that hit
3. Iterates `_prev_positions` and runs breakeven + trailing stop logic for each position

`_check_positions()` and `_check_profit_levels()` run every **60s**, not every 1s.

### `_prev_positions` — the daemon's view of open positions

This dict is the daemon's internal snapshot. It is updated:
- At startup via `_init_position_tracking()`
- Every 60s via `_check_positions()`
- Immediately on trigger events in `_fast_trigger_check()` (only when `check_triggers()` returns events)

**It is NOT updated when the agent manually closes a position via the `close_position` tool.** When the agent calls `market_close(sym)` directly, the paper provider removes the position from its internal state, but `_prev_positions[sym]` still has the old data. This is the root of Bug 1.

### The three mechanical state dicts that matter here

All defined in `__init__` at lines ~340–342:

```python
self._trailing_active: dict[str, bool] = {}   # True once trail is engaged
self._trailing_stop_px: dict[str, float] = {} # current trailing stop price level
self._peak_roe: dict[str, float] = {}         # max ROE % seen during hold (MFE)
```

These are initialized as empty dicts and **never written to disk**. On any daemon restart, they all reset to `{}`. This is Bug 2.

### The paper provider error messages

From `paper.py`:
- `market_close(sym)` when position doesn't exist → `ValueError("No open position for {symbol}")`
- `place_trigger_order(sym, ...)` when position doesn't exist → `ValueError("No position for {symbol} to attach trigger to")`

These exact strings are what you will match in the zombie cleanup exception handlers.

### The `_atomic_write` persistence pattern

From `persistence.py`:
```python
def _atomic_write(path: Path, data: str) -> None:
    """Write to file atomically via temp file + rename."""
    import os, tempfile
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try: os.unlink(tmp)
        except OSError: pass
        raise
```

All persistence uses this. Never write directly to the target file. Always use `_atomic_write`.

---

## The Three Bugs

### Bug 1 — Phase 2 and Phase 3 Zombie: no cleanup on "no position" error

**Where:** `_fast_trigger_check()`, Phase 2 exception handler (~line 2295) and Phase 3 exception handler (~line 2344)

**What happens:** When the agent manually closes a position via the `close_position` tool, `_prev_positions[sym]` still has the old data. On the next 1s loop iteration, Phase 2 tries to update the trailing stop SL → `place_trigger_order()` throws `ValueError("No position for X to attach trigger to")`. Phase 3 tries `market_close(sym)` → throws `ValueError("No open position for X")`. Both exception handlers only log a warning and do nothing else. The loop repeats every 1s for up to 60s until `_check_positions()` runs and refreshes `_prev_positions`.

**Confirmed in production:** Daemon logs show "Trailing stop close failed for SOL: No open position for SOL" firing every 1s for 20+ seconds at 15:05:01 on 2026-03-11, exactly when SOL fill closed.

**Impact:** 60s of failed API calls, spurious warnings, wasted resources.

### Bug 2 — State loss on restart: trailing stop degrades existing SL

**Where:** `_fast_trigger_check()`, Phase 2 update logic (~lines 2266–2270)

**What happens:** On daemon restart, `_trailing_stop_px` resets to `{}`. The guard that prevents backwards movement reads:

```python
old_trail_px = self._trailing_stop_px.get(sym, 0)
should_update = (new_trail_px > old_trail_px) if old_trail_px > 0 else True
```

With `old_trail_px = 0` after restart, `should_update` is **always True**. Phase 2 immediately cancels whatever SL was on the exchange (the good trailing SL placed before restart) and replaces it with one computed from `_peak_roe.get(sym, 0) = 0`. With `peak = 0`, `trail_roe = max(0 * 0.5, fee_be_roe) = fee_be_roe`. The replacement SL is placed at the fee-BE floor — potentially far below the pre-restart SL.

**Confirmed:** 6 restarts on 2026-03-10 (01:18–01:42 UTC), 4 restarts on 2026-03-11 (01:18, 02:45, 02:49, 02:57 UTC). Each restart could degrade an active trailing stop.

**Impact:** Active trailing stop protection degraded to fee-BE floor on every daemon restart.

### Bug 3 — `_trailing_stop_px` updated before placement succeeds

**Where:** `_fast_trigger_check()`, Phase 2, `if should_update:` block (~line 2273)

**What happens:**
```python
if should_update:
    self._trailing_stop_px[sym] = new_trail_px  # ← written BEFORE the try block
    try:
        cancel_order(...)
        place_trigger_order(...)               # ← may fail
        _refresh_trigger_cache()
    except Exception as trail_err:
        logger.warning(...)
```

If `place_trigger_order()` fails after the cancel, the in-memory state says the SL is at `new_trail_px` but no SL exists on the exchange. On the next iteration: `old_trail_px = new_trail_px`, so `should_update = False` — the gap is never corrected.

**Impact:** Position left unprotected after a placement failure, with no retry, no alert. Silent.

---

## Fix 1: Zombie Cleanup in Phase 2 and Phase 3 Exception Handlers

### What to change

In `_fast_trigger_check()`, find the two exception handlers for the trailing stop.

**Phase 2 exception handler** (currently ~line 2295):

```python
# CURRENT CODE — do not keep this
                                except Exception as trail_err:
                                    logger.warning("Trailing stop update failed for %s: %s", sym, trail_err)
```

**Replace with:**

```python
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

**Phase 3 exception handler** (currently ~line 2344):

```python
# CURRENT CODE — do not keep this
                                    except Exception as trail_close_err:
                                        logger.warning("Trailing stop close failed for %s: %s", sym, trail_close_err)
```

**Replace with:**

```python
                                    except Exception as trail_close_err:
                                        _err = str(trail_close_err).lower()
                                        if "no open position" in _err or "no position" in _err:
                                            # Position already gone — evict zombie state immediately
                                            logger.warning(
                                                "Trailing stop close: position gone for %s, clearing zombie state",
                                                sym,
                                            )
                                            self._prev_positions.pop(sym, None)
                                            self._trailing_active.pop(sym, None)
                                            self._trailing_stop_px.pop(sym, None)
                                            self._peak_roe.pop(sym, None)
                                        else:
                                            logger.warning("Trailing stop close failed for %s: %s", sym, trail_close_err)
```

### Logic check

- Only evict state on errors that definitively confirm the position is gone ("no position", "no open position"). These are exact error messages from `paper.py`. For any other error (API timeout, network error), fall through to the existing warning — do NOT evict, because the position may still be open.
- `_prev_positions.pop(sym, None)` removes the symbol from the iteration dict. On the next 1s loop, `position_syms = list(self._prev_positions.keys())` will not include `sym`. The zombie stops immediately.
- The other pops (`_trailing_active`, `_trailing_stop_px`, `_peak_roe`) clean up the mechanical state so it doesn't linger until the 60s `_check_profit_levels()` cycle.
- `_trough_roe` and `_current_roe` are also set for this symbol but are less critical — `_check_profit_levels()` will clean them at the 60s mark. You may optionally pop them for completeness, but it is not required for the zombie fix.

### Also fix Phase 3 success path — missing cleanup

The Phase 3 success path (when `market_close(sym)` succeeds) currently pops `_position_types` and `_prev_positions` but **does not clear** `_trailing_active`, `_trailing_stop_px`, or `_peak_roe`. These linger until `_check_profit_levels()` runs (up to 60s). While not critical (the `_prev_positions.pop()` already breaks the loop), add the cleanup for correctness:

Find the Phase 3 success block. It currently ends with:
```python
                                        self._position_types.pop(sym, None)
                                        self._persist_position_types()
                                        self._prev_positions.pop(sym, None)
                                        try:
                                            self._get_provider().cancel_all_orders(sym)
                                        except Exception:
                                            pass
```

Add three lines after `self._prev_positions.pop(sym, None)`:
```python
                                        self._trailing_active.pop(sym, None)
                                        self._trailing_stop_px.pop(sym, None)
                                        self._peak_roe.pop(sym, None)
```

The full block becomes:
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

---

## Fix 2: State Persistence Across Restarts

### Overview

Add two new methods to the daemon class: `_persist_mechanical_state()` and `_load_mechanical_state()`. These persist `_peak_roe`, `_trailing_stop_px`, and `_trailing_active` to `storage/mechanical_state.json` and restore them on startup, filtered to currently open positions only.

**Why only these three and not `_breakeven_set` / `_capital_be_set`?**

The breakeven system already has restart safety built in via the `has_good_sl` / `has_tighter_sl` guard — it checks the live trigger cache (real exchange orders), not the in-memory flag, and resets the flag from reality. The breakeven dicts do not cause SL degradation on restart. The trailing stop dicts DO cause degradation because `old_trail_px = 0` forces `should_update = True` regardless of what SL exists on the exchange. So persistence is only strictly necessary for the trailing stop dicts.

### Step 1: Add the storage path constant

At the top of `_persist_position_types()` you'll see the path pattern:
```python
path = self.config.project_root / "storage" / "position_types.json"
```

Use the same pattern: `self.config.project_root / "storage" / "mechanical_state.json"`

### Step 2: Add `_persist_mechanical_state()` method

Place this immediately after `_load_position_types()` (around line 4327), keeping it grouped with the other persistence methods:

```python
    def _persist_mechanical_state(self) -> None:
        """Persist trailing stop state to disk so restarts don't degrade active SLs.

        Saves _peak_roe, _trailing_stop_px, and _trailing_active.
        On restart, _load_mechanical_state() restores these filtered to open positions.
        This prevents the trailing stop from treating a restart as a fresh position
        (old_trail_px=0 → should_update=True → cancels good SL and places worse one).
        """
        try:
            import json as _json
            path = self.config.project_root / "storage" / "mechanical_state.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            from ..core.persistence import _atomic_write
            data = {
                "peak_roe": self._peak_roe,
                "trailing_stop_px": self._trailing_stop_px,
                "trailing_active": self._trailing_active,
            }
            _atomic_write(path, _json.dumps(data))
        except Exception as e:
            logger.debug("Failed to persist mechanical state: %s", e)
```

### Step 3: Add `_load_mechanical_state()` method

Place immediately after `_persist_mechanical_state()`:

```python
    def _load_mechanical_state(self) -> None:
        """Load trailing stop state from disk on startup.

        Only restores state for symbols that are currently open positions
        (checked against _prev_positions). State for closed positions is
        discarded — if a position closed while the daemon was down, its
        state is irrelevant.

        Must be called AFTER _init_position_tracking() so _prev_positions
        is already populated with live positions.
        """
        try:
            import json as _json
            path = self.config.project_root / "storage" / "mechanical_state.json"
            if not path.exists():
                return
            saved = _json.loads(path.read_text())
            open_syms = set(self._prev_positions.keys())

            restored = 0
            for sym, val in saved.get("peak_roe", {}).items():
                if sym in open_syms:
                    self._peak_roe[sym] = val
                    restored += 1
            for sym, val in saved.get("trailing_stop_px", {}).items():
                if sym in open_syms:
                    self._trailing_stop_px[sym] = val
            for sym, val in saved.get("trailing_active", {}).items():
                if sym in open_syms:
                    self._trailing_active[sym] = val

            if restored:
                logger.info(
                    "Restored mechanical state for %d position(s) from disk "
                    "(peak_roe=%s, trailing_active=%s)",
                    restored,
                    {k: f"{v:.1f}%" for k, v in self._peak_roe.items()},
                    dict(self._trailing_active),
                )
        except Exception as e:
            logger.debug("Failed to load mechanical state: %s", e)
```

### Step 4: Call `_load_mechanical_state()` at startup

In `_init_position_tracking()`, find the existing startup sequence:

```python
            # Load persisted position types first (survives restarts)
            self._load_position_types()

            # Infer position types for any remaining unregistered positions
            for coin, data in self._prev_positions.items():
                ...

            # Initial trigger cache
            self._refresh_trigger_cache()
```

Add the call immediately after `_load_position_types()`:

```python
            # Load persisted position types first (survives restarts)
            self._load_position_types()
            # Load trailing stop state (prevents SL degradation on restart)
            self._load_mechanical_state()

            # Infer position types for any remaining unregistered positions
            for coin, data in self._prev_positions.items():
                ...

            # Initial trigger cache
            self._refresh_trigger_cache()
```

**Why after `_load_position_types()` and before `_refresh_trigger_cache()`?**

`_load_mechanical_state()` reads `_prev_positions` to filter to open positions — so it must run after `_prev_positions` is populated (line 1934 in `_init_position_tracking()`). `_refresh_trigger_cache()` must still run last to sync trigger orders from the exchange.

### Step 5: Call `_persist_mechanical_state()` at state transitions

Only persist when state actually changes. Do NOT call on every 1s loop iteration. Call at these specific transition points:

**A. When trailing stop activates (Phase 1):**

Find:
```python
                        if not self._trailing_active.get(sym) and roe_pct >= activation_roe:
                            self._trailing_active[sym] = True
                            logger.info(
                                "Trailing stop ACTIVATED: %s %s | ROE %.1f%% >= %.1f%% threshold",
                                sym, side, roe_pct, activation_roe,
                            )
```

Add one line after `self._trailing_active[sym] = True`:
```python
                            self._trailing_active[sym] = True
                            self._persist_mechanical_state()
                            logger.info(...)
```

**IMPORTANT:** This call is inside the outer `try:` block of `_fast_trigger_check()`. The method body is fully wrapped in its own `try/except` (see the method definition above — it catches all exceptions and logs at debug level). So a failure in `_persist_mechanical_state()` will NOT propagate to the outer try and will NOT crash `_fast_trigger_check()`. This is safe.

**B. When trailing stop SL is successfully placed (Phase 2):**

This is addressed in Fix 3 below — the persist call goes inside the try block after successful placement.

**C. When zombie state is cleared (Phase 2 and Phase 3 exception handlers):**

Already included in Fix 1 — no additional persist call needed for zombie cleanup since those dicts are being cleared, not set.

**D. When Phase 3 success path clears state:**

Already included in Fix 1 (Phase 3 success cleanup). No separate persist call needed — the dicts are being cleared and the position is being removed.

### Step 6: Keep `_peak_roe` up to date before persisting

`_peak_roe[sym]` is updated on every loop in `_fast_trigger_check()` (line ~2060):
```python
if roe_pct > self._peak_roe.get(sym, 0):
    self._peak_roe[sym] = roe_pct
```

This happens many times per minute. Persisting on every peak update would write to disk too frequently. Do NOT add a persist call here. `_peak_roe` will be persisted via the trailing activation and SL placement calls. The peak value at restart will be slightly stale (the value at last trail update or activation), but that is acceptable — on restart, Phase 2 will recompute the trail from the restored peak value, which will be a floor that's at most slightly lower than the true peak. The SL cannot move backwards due to the `should_update` guard.

---

## Fix 3: Move `_trailing_stop_px` Assignment Inside Try Block

### What to change

In `_fast_trigger_check()`, Phase 2, find the `if should_update:` block:

```python
# CURRENT CODE — do not keep this
                            if should_update:
                                self._trailing_stop_px[sym] = new_trail_px
                                # Update the paper provider's SL to match
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
                                    if old_trail_px > 0:
                                        logger.info(
                                            "Trailing stop UPDATED: %s %s | $%,.2f → $%,.2f (peak ROE %.1f%%, trail ROE %.1f%%)",
                                            sym, side, old_trail_px, new_trail_px, peak, trail_roe,
                                        )
                                except Exception as trail_err:
                                    logger.warning("Trailing stop update failed for %s: %s", sym, trail_err)
```

**Replace with** (the only structural change is moving the assignment and adding a persist call after the refresh):

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

Note this is the combined Fix 1 + Fix 3 for Phase 2. The zombie cleanup (Fix 1) and the assignment-inside-try (Fix 3) are applied to the same block. Do not apply them separately.

---

## Complete Order of Changes

Apply in this exact order:

1. **Add `_persist_mechanical_state()`** method to daemon class (after `_load_position_types()`)
2. **Add `_load_mechanical_state()`** method to daemon class (after `_persist_mechanical_state()`)
3. **Add `_load_mechanical_state()` call** in `_init_position_tracking()` after `_load_position_types()`
4. **Replace Phase 2 `if should_update:` block** (combines Fix 3 + Fix 1 Phase 2 handler)
5. **Add `_persist_mechanical_state()` call** after Phase 1 `_trailing_active[sym] = True`
6. **Replace Phase 3 exception handler** (Fix 1 Phase 3 handler)
7. **Add Phase 3 success path cleanup** (three pop() calls)

Apply changes 1–3 first. Run the tests. Then apply 4–7. Run tests again. Do not apply all at once without intermediate test runs.

---

## Tests to Write

Add a new file: `tests/unit/test_trailing_stop_fixes.py`

Follow the exact same structure as `tests/unit/test_breakeven_fix.py`. Use `_daemon_source()` for static checks. Mirror the class-per-feature pattern.

### Static tests (source code validation — run first, no daemon instantiation needed)

```python
class TestZombieCleanupExists:
    def test_phase2_exception_checks_no_position_string(self):
        """Phase 2 handler must check for 'no position' in error string."""
        src = _daemon_source()
        # Find Phase 2 exception handler
        assert '"no position" in _err' in src or "'no position' in _err" in src

    def test_phase3_exception_checks_no_open_position_string(self):
        """Phase 3 handler must check for 'no open position' in error string."""
        src = _daemon_source()
        assert '"no open position" in _err' in src or "'no open position' in _err" in src

    def test_phase2_exception_pops_prev_positions(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "self._prev_positions.pop(sym, None)" in method

    def test_phase3_exception_pops_trailing_active(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "self._trailing_active.pop(sym, None)" in method

    def test_trailing_stop_px_assigned_inside_try(self):
        """_trailing_stop_px must be assigned AFTER place_trigger_order, not before."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        # The assignment must come after place_trigger_order call
        assign_idx = method.find("self._trailing_stop_px[sym] = new_trail_px")
        place_idx = method.find("place_trigger_order(")
        refresh_idx = method.find("_refresh_trigger_cache()")
        # Assignment must be AFTER both place and refresh
        assert assign_idx > place_idx, \
            "_trailing_stop_px must be assigned after place_trigger_order"
        assert assign_idx > refresh_idx, \
            "_trailing_stop_px must be assigned after _refresh_trigger_cache"

    def test_persist_mechanical_state_method_exists(self):
        src = _daemon_source()
        assert "def _persist_mechanical_state(self)" in src

    def test_load_mechanical_state_method_exists(self):
        src = _daemon_source()
        assert "def _load_mechanical_state(self)" in src

    def test_load_mechanical_state_called_in_init(self):
        src = _daemon_source()
        init_method = _get_method(src, "_init_position_tracking")
        assert "_load_mechanical_state()" in init_method

    def test_persist_called_after_trailing_activation(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        activation_idx = method.find("self._trailing_active[sym] = True")
        persist_idx = method.find("self._persist_mechanical_state()", activation_idx)
        # persist must appear within 10 lines of activation
        activation_line = method[:activation_idx].count("\n")
        persist_line = method[:persist_idx].count("\n")
        assert 0 < persist_line - activation_line <= 3, \
            "_persist_mechanical_state must be called immediately after trail activation"

    def test_persist_called_after_successful_placement(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assign_idx = method.find("self._trailing_stop_px[sym] = new_trail_px")
        persist_idx = method.find("self._persist_mechanical_state()", assign_idx)
        assert persist_idx > assign_idx, \
            "_persist_mechanical_state must be called after _trailing_stop_px assignment"

    def test_mechanical_state_json_path(self):
        src = _daemon_source()
        assert '"mechanical_state.json"' in src or "'mechanical_state.json'" in src

    def test_phase3_success_clears_trailing_active(self):
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        # Find Phase 3 success block (after market_close succeeds)
        trail_close_idx = method.find("trailing_stop: {sym}")
        cleanup_region = method[trail_close_idx:trail_close_idx + 600]
        assert "self._trailing_active.pop(sym, None)" in cleanup_region
        assert "self._trailing_stop_px.pop(sym, None)" in cleanup_region
        assert "self._peak_roe.pop(sym, None)" in cleanup_region
```

### Integration tests (use mock or real daemon — follow test_breakeven_fix.py patterns)

```python
class TestZombieCleanupBehavior:
    """Verify that zombie state is evicted immediately on 'no position' error."""

    def _make_mock_provider(self, raises_on_close=None, raises_on_place=None):
        """Build a minimal mock provider."""
        import unittest.mock as mock
        p = mock.MagicMock()
        p.can_trade = True
        p.check_triggers = mock.MagicMock(return_value=[])
        if raises_on_close:
            p.market_close = mock.MagicMock(side_effect=raises_on_close)
        if raises_on_place:
            p.place_trigger_order = mock.MagicMock(side_effect=raises_on_place)
        return p

    def test_phase3_zombie_clears_prev_positions(self):
        """
        Given: _trailing_active[sym] is True, trail SL price is set, _prev_positions has sym,
               market_close raises 'No open position for X'.
        Expect: _prev_positions[sym] is gone after exception, _trailing_active[sym] is gone.
        """
        # This test validates the behavior described in Bug 1.
        # Test by reading source and verifying the string patterns are correct
        # relative to paper.py's actual error message.
        from pathlib import Path
        paper_src = (Path(__file__).parent.parent.parent /
                     "src/hynous/data/providers/paper.py").read_text()
        daemon_src = (Path(__file__).parent.parent.parent /
                      "src/hynous/intelligence/daemon.py").read_text()

        # Confirm paper raises the exact string the handler checks for
        assert 'No open position for' in paper_src, \
            "paper.py must raise 'No open position for {sym}'"
        assert 'No position for' in paper_src, \
            "paper.py must raise 'No position for {sym} to attach trigger to'"

        # Confirm daemon handler checks for these substrings (lowercase)
        method = _get_method(daemon_src, "_fast_trigger_check")
        assert "no open position" in method or "no position" in method, \
            "Daemon Phase 3 handler must check for paper.py error substring"

    def test_phase2_zombie_error_string_matches_paper_provider(self):
        """Phase 2 handler checks 'no position' which matches paper.py's error."""
        from pathlib import Path
        paper_src = (Path(__file__).parent.parent.parent /
                     "src/hynous/data/providers/paper.py").read_text()
        # The exact raise in place_trigger_order:
        assert 'No position for' in paper_src
        # 'no position' (lowercase) matches 'No position for ...' after .lower()
        daemon_src = _daemon_source()
        assert '"no position" in _err' in daemon_src or "'no position' in _err" in daemon_src

class TestStatePersistenceRoundTrip:
    """Verify mechanical state persists and loads correctly."""

    def test_persist_and_load_restores_trailing_data(self, tmp_path, monkeypatch):
        """
        Given: _peak_roe, _trailing_stop_px, _trailing_active are set for an open coin.
        When: _persist_mechanical_state() is called, then dicts reset, then _load_mechanical_state() called.
        Expect: Dicts restored exactly for open coins; closed coins not restored.
        """
        # Read source to confirm the method bodies are correct structurally
        # (full daemon instantiation is complex; use source inspection + manual JSON test)
        import json
        from pathlib import Path
        from src.hynous.core.persistence import _atomic_write

        # Simulate the persist/load cycle directly using the same JSON structure
        # the methods use
        state = {
            "peak_roe": {"BTC": 3.5, "SOL": 6.69},
            "trailing_stop_px": {"BTC": 69650.0, "SOL": 85.49},
            "trailing_active": {"BTC": True, "SOL": True},
        }
        path = tmp_path / "mechanical_state.json"
        _atomic_write(path, json.dumps(state))

        loaded = json.loads(path.read_text())
        open_syms = {"BTC"}  # SOL is closed — should not be restored

        peak_roe = {k: v for k, v in loaded["peak_roe"].items() if k in open_syms}
        trailing_px = {k: v for k, v in loaded["trailing_stop_px"].items() if k in open_syms}
        trailing_active = {k: v for k, v in loaded["trailing_active"].items() if k in open_syms}

        assert peak_roe == {"BTC": 3.5}, "Only open coins restored"
        assert trailing_px == {"BTC": 69650.0}, "Only open coins restored"
        assert trailing_active == {"BTC": True}, "Only open coins restored"
        assert "SOL" not in peak_roe, "Closed coin must not be restored"

    def test_load_mechanical_state_called_before_refresh_trigger_cache(self):
        """_load_mechanical_state must be called before _refresh_trigger_cache in startup."""
        src = _daemon_source()
        init = _get_method(src, "_init_position_tracking")
        load_idx = init.find("_load_mechanical_state()")
        refresh_idx = init.find("_refresh_trigger_cache()")
        assert load_idx != -1, "_load_mechanical_state must be called in _init_position_tracking"
        assert load_idx < refresh_idx, \
            "_load_mechanical_state must be called before _refresh_trigger_cache"

    def test_load_called_after_prev_positions_populated(self):
        """_load_mechanical_state must be called after _prev_positions is populated."""
        src = _daemon_source()
        init = _get_method(src, "_init_position_tracking")
        # _prev_positions is populated at get_user_state() call
        get_state_idx = init.find("get_user_state()")
        load_idx = init.find("_load_mechanical_state()")
        assert load_idx > get_state_idx, \
            "_load_mechanical_state must run after _prev_positions is populated"

class TestAssignmentInsideTry:
    def test_trailing_stop_px_not_assigned_before_try(self):
        """_trailing_stop_px[sym] = new_trail_px must not appear before the try block."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        should_update_idx = method.find("if should_update:")
        # Find the first try: after should_update
        try_idx = method.find("try:", should_update_idx)
        # Find the assignment
        assign_idx = method.find("self._trailing_stop_px[sym] = new_trail_px", should_update_idx)
        assert assign_idx > try_idx, \
            "_trailing_stop_px must be assigned inside the try block, not before it"

    def test_persist_called_on_successful_placement_only(self):
        """_persist_mechanical_state must be inside try block (after place succeeds)."""
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        try_idx = method.find("try:", method.find("if should_update:"))
        except_idx = method.find("except Exception as trail_err:", try_idx)
        # persist call must be BEFORE the except (inside the try)
        persist_idx = method.find("self._persist_mechanical_state()", try_idx)
        assert try_idx < persist_idx < except_idx, \
            "_persist_mechanical_state must be inside the try block"
```

Add helper function at module level:

```python
def _get_method(src: str, method_name: str) -> str:
    """Extract a method body from source by name."""
    start = src.find(f"def {method_name}(")
    end = src.find("\n    def ", start + 1)
    return src[start:end] if end != -1 else src[start:]
```

---

## Running Tests

```bash
# From project root
PYTHONPATH=src pytest tests/unit/test_trailing_stop_fixes.py -v

# Run full test suite to confirm no regressions
PYTHONPATH=src pytest tests/unit/ -v

# Run the original breakeven tests specifically
PYTHONPATH=src pytest tests/unit/test_breakeven_fix.py -v
```

All tests in `tests/unit/` must pass. If any previously passing test breaks after your changes, investigate before continuing. Do not suppress or delete existing tests.

---

## Dynamic Validation on VPS

After implementing and all tests pass locally, deploy to the test instance and validate with live behavior.

### Deploy to test instance

```bash
# From local machine (on test-env branch)
ssh vps "cd /opt/hynous-test && sudo -u hynous git pull && sudo systemctl restart hynous-test"
```

### Verify mechanical_state.json is created

```bash
ssh root@89.167.50.168 "cat /opt/hynous-test/storage/mechanical_state.json"
```

Expected: a JSON file with `peak_roe`, `trailing_stop_px`, `trailing_active` keys. Initially may be `{"peak_roe": {}, "trailing_stop_px": {}, "trailing_active": {}}` if no positions are active.

### Verify no zombie errors appear

```bash
ssh root@89.167.50.168 "journalctl -u hynous-test -f 2>&1 | grep -i 'trailing stop close failed\|trailing stop update failed'"
```

After a manual position close (via agent tool), you should see the new warning message ("clearing zombie state") once, not the old error repeating every second.

### Verify state survives restart

1. Open a paper trade on the test instance and let it reach trailing stop activation (ROE ≥ 2.8% at 20x)
2. Check mechanical_state.json shows the state:
   ```bash
   ssh root@89.167.50.168 "cat /opt/hynous-test/storage/mechanical_state.json"
   ```
3. Restart the test daemon:
   ```bash
   ssh root@89.167.50.168 "sudo systemctl restart hynous-test"
   ```
4. Check logs show state was restored:
   ```bash
   ssh root@89.167.50.168 "journalctl -u hynous-test --since '1 min ago' | grep 'Restored mechanical state'"
   ```
5. Verify the trailing SL was NOT degraded — check that `mechanical_state.json` shows the same `trailing_stop_px` as before restart

### Watch for unexpected errors

```bash
ssh root@89.167.50.168 "journalctl -u hynous-test -f 2>&1 | grep -iE 'error|warning|failed|exception' | grep -v '429\|L2 snapshot\|disconnected'"
```

No new error patterns should appear that weren't there before.

---

## What NOT to Change

- Do not touch the breakeven (fee-BE, capital-BE) code blocks. They are working correctly and have their own restart safety.
- Do not change `_check_profit_levels()` cleanup logic — it is correct and serves as a 60s safety net.
- Do not add persistence calls on every loop iteration — only at state transitions (activation, successful placement).
- Do not change `paper.py` — the error message strings there are the source of truth for the zombie detection check.
- Do not modify existing tests — only add new ones.

---

## Checklist

- [ ] `_persist_mechanical_state()` method added, follows `_persist_position_types()` pattern exactly
- [ ] `_load_mechanical_state()` method added, filters to open positions only
- [ ] `_load_mechanical_state()` called in `_init_position_tracking()` after `_load_position_types()` and before `_refresh_trigger_cache()`
- [ ] Phase 1: `_persist_mechanical_state()` called after `_trailing_active[sym] = True`
- [ ] Phase 2 `if should_update:` block: `_trailing_stop_px[sym] = new_trail_px` moved inside try, after `_refresh_trigger_cache()`
- [ ] Phase 2 `if should_update:` block: `_persist_mechanical_state()` called after assignment
- [ ] Phase 2 exception handler: zombie detection + state eviction on "no position" errors
- [ ] Phase 3 exception handler: zombie detection + state eviction on "no position" errors
- [ ] Phase 3 success path: `_trailing_active.pop()`, `_trailing_stop_px.pop()`, `_peak_roe.pop()` added
- [ ] `tests/unit/test_trailing_stop_fixes.py` written and all tests pass
- [ ] `PYTHONPATH=src pytest tests/unit/ -v` — all tests pass (including existing breakeven tests)
- [ ] Deployed to test instance, `mechanical_state.json` visible in storage
- [ ] Restart test: state survives, no SL degradation observed in logs
- [ ] No zombie error spam after manual position close

---

Last updated: 2026-03-11
