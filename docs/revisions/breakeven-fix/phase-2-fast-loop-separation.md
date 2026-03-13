# Phase 2: Fast Loop Separation (Future Consideration)

> Only pursue this if Phase 1 (background wake threads) proves insufficient.

## Problem

Phase 1 moves 7 `_wake_agent()` call sites to background threads, eliminating 10-60s LLM blocking from the main loop. However, two sources of blocking remain:

1. **Scanner wake** (`_wake_for_scanner`, line 1077) stays synchronous because it needs the response text for phantom creation + `agent._last_tool_calls` for trade detection.
2. **Periodic I/O** in the main loop: `_poll_prices()` (1-4s every 60s), `_poll_derivatives()` (3-8s every 300s), `_update_peaks_from_candles()` (0.1-0.8s per position every 60s). These are sequential HTTP calls that delay the next `_fast_trigger_check()`.

Combined, these create 1-8s gaps between trigger checks. At 20x leverage, a 0.05% price move crosses the 0.5% ROE capital-BE threshold, and SOL can move 0.05% in well under 1 second.

## Proposed Architecture

Split the main loop into two threads:

### Fast Thread (1s loop, mechanical exits only)
```
while running:
    _fast_trigger_check()
    if 60s elapsed and positions open:
        _update_peaks_from_candles()
    time.sleep(1)
```

Reads: `_prev_positions`, `_peak_roe`, `_trailing_active`, `_trailing_stop_px`, `_breakeven_set`, `_capital_be_set`, `_tracked_triggers`
Writes: `_peak_roe`, `_trough_roe`, `_current_roe`, `_trailing_active`, `_trailing_stop_px`, `_breakeven_set`, `_capital_be_set`

### Slow Thread (existing loop minus fast-path)
```
while running:
    _poll_prices()             # 60s
    _check_positions()         # 60s
    _check_profit_levels()     # 60s
    _poll_derivatives()        # 300s
    _check_watchpoints()       # on data change
    scanner detect             # on data change
    curiosity / review / etc.  # timer-gated
    time.sleep(1)
```

Writes: `_prev_positions`, `_tracked_triggers` (via `_refresh_trigger_cache`), `_position_types`, all other daemon state.

### Shared State Lock

A single `threading.Lock` (`self._state_lock`) guards all shared mutable dicts:

```python
# Fast thread acquires briefly for dict reads/writes (~microseconds)
with self._state_lock:
    pos = self._prev_positions.get(sym)
    ...

# Slow thread acquires for bulk updates (~milliseconds)
with self._state_lock:
    self._prev_positions = new_positions
    self._refresh_trigger_cache()
```

Contention is minimal: fast thread holds the lock for individual dict operations (microseconds), slow thread holds it for bulk replacements (milliseconds, every 60s).

## Risks

- **Testing complexity**: Two threads means non-deterministic execution order in tests.
- **Lock discipline**: Every shared dict access must use the lock. Missing one = intermittent bug.
- **Provider-level multi-step operations**: cancel-old-SL + place-new-SL is two calls. A slow-thread refresh between them could cause stale trigger cache reads. May need per-symbol operation locks.

## Validation Criteria

Before pursuing Phase 2, measure Phase 1's effectiveness:

1. Add logging: `logger.debug("fast_trigger_check latency: %.1fms", (time.time() - t0) * 1000)` at the end of `_fast_trigger_check()`.
2. Track max gap between consecutive `_fast_trigger_check` calls over 24h.
3. If max gap > 5s with Phase 1 deployed, Phase 2 is warranted.
4. If max gap <= 2s (just periodic I/O), Phase 1 is sufficient.

## Estimated Scope

~200-300 lines of changes. Recommend as a separate revision track if needed.

---

Last updated: 2026-03-13
