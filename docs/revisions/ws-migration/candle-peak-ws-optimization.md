# Candle Peak Tracking — WS-First Optimization

> **Status:** Ready for implementation
> **Priority:** Low — optimization, not a bug fix
> **Branch:** `test-env`
> **Files touched:** `src/hynous/intelligence/daemon.py`, `src/hynous/data/providers/ws_feeds.py`

---

## Required Reading Before Starting

Read ALL of these before writing a single line of code. Do not skip any.

1. **`CLAUDE.md`** (project root) — codebase conventions, testing instructions (`PYTHONPATH=src pytest tests/`)
2. **`docs/revisions/ws-migration/README.md`** — WS migration context, the Phase 1 architecture, and why WS-first matters
3. **`src/hynous/intelligence/daemon.py`** — read specifically:
   - `_update_peaks_from_candles()` (lines 2549–2684) — the method you are modifying; understand every line
   - `_fetch_satellite_candles()` (lines 1766–1806) — the **reference pattern** you are replicating; study the WS-first logic at lines 1780–1790
   - `_loop_inner()` (lines 1048–1059) — how `_update_peaks_from_candles()` is called (60s interval, guarded by `candle_peak_tracking_enabled`)
4. **`src/hynous/data/providers/ws_feeds.py`** — read specifically:
   - `get_candles()` (lines 174–184) — the WS cache accessor; note the **10-candle minimum** at line 182
   - `_handle_candle()` (lines 438–476) — how WS candles are stored; understand the upsert logic (same-timestamp replace vs append)
   - `_candle_windows` initialization (lines 83–86) — deque maxlens: 300 for 1m, 100 for 5m
5. **`src/hynous/data/providers/hyperliquid.py`** — read specifically:
   - `get_candles()` (lines 701–733) — the REST candle fetcher; confirm it does NOT check WS
   - `get_all_prices()` (lines 679–690) — the WS-first pattern for prices that we are mirroring
6. **`tests/unit/test_candle_peak_tracking.py`** — the existing 19 tests; your new tests must follow the same style
7. **`tests/unit/test_ws_price_feed.py`** — study source inspection patterns (`_daemon_source()`, method extraction, string presence checks)

---

## Problem

`_update_peaks_from_candles()` runs every 60 seconds. For each open position, it calls `provider.get_candles(sym, "1m", start_ms, now_ms)` — a REST HTTP call. With 3 open positions, that's 3 REST calls per minute.

Meanwhile, the `MarketDataFeed` in `ws_feeds.py` is already subscribing to `candle` channels for every tracked coin and storing 1m candle data in rolling deques (`_candle_windows`). This WS data updates in real-time (on every candle close and intra-candle updates) and sits unused by peak tracking.

The satellite candle fetcher (`_fetch_satellite_candles`, line 1766) already implements the correct WS-first pattern — it checks `feed.get_candles()` before falling back to REST. Peak tracking should do the same.

---

## What Changes

**One method modified, one method added.** No config changes, no new state, no new dependencies.

### Change 1: Add `_get_ws_candle_feed()` helper

**File:** `src/hynous/intelligence/daemon.py`

**Location:** Immediately before `_update_peaks_from_candles()` (before line 2549)

**Purpose:** Extracts the MarketDataFeed from the provider, handling the Paper wrapper. This is the same getattr chain used at lines 1781–1782 in `_fetch_satellite_candles()`, extracted into a reusable helper so both methods share one pattern.

**Add this method:**

```python
    def _get_ws_candle_feed(self):
        """Get the MarketDataFeed instance from the provider, unwrapping Paper if needed.

        Returns None if WS feed is not available (WS disabled or not connected).
        """
        provider = self._get_provider()
        real = getattr(provider, "_real", provider)
        return getattr(real, "_market_feed", None)
```

**Why a helper:** The getattr unwrap chain is already duplicated at line 1781. Extracting it prevents a third copy and makes the pattern testable. If the Paper wrapper structure ever changes, there's one place to fix.

---

### Change 2: Modify `_update_peaks_from_candles()` candle fetch

**File:** `src/hynous/intelligence/daemon.py`

**Location:** Lines 2559–2575 (the candle fetch section at the top of the method)

**Current code (lines 2559–2575):**

```python
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
```

**Replace with:**

```python
        provider = self._get_provider()
        now_ms = int(time.time() * 1000)
        # Fetch last 2 minutes of 1m candles — ensures we get the just-closed candle
        start_ms = now_ms - 2 * 60 * 1000

        # WS-first: try MarketDataFeed candle cache before REST.
        # Fetched once outside the loop — same feed instance for all coins.
        feed = self._get_ws_candle_feed()

        for sym, pos in self._prev_positions.items():
            entry_px = pos.get("entry_px", 0)
            leverage = pos.get("leverage", 20)
            side = pos.get("side", "long")
            if entry_px <= 0:
                continue

            candles = None

            # Try WS candle cache first (zero API calls)
            if feed:
                ws_candles = feed.get_candles(sym, "1m", count=2)
                if ws_candles:
                    candles = ws_candles

            # REST fallback if WS unavailable or insufficient data
            if not candles:
                try:
                    candles = provider.get_candles(sym, "1m", start_ms, now_ms)
                except Exception:
                    logger.debug("Candle peak tracking failed for %s", sym)
                    continue

            if not candles:
                continue
```

**What changed:**
1. `feed = self._get_ws_candle_feed()` fetched once before the loop (not per-symbol)
2. Inside the loop: try `feed.get_candles(sym, "1m", count=2)` first
3. If WS returns data, use it; if not (None), fall back to the existing REST call
4. The `if not candles: continue` guard (previously at line 2577) is preserved — handles both WS and REST returning empty

**Why `count=2`:** Peak tracking only needs the last 2 minutes of 1m candles (the current forming candle + the just-closed one). This matches the existing `start_ms = now_ms - 2 * 60 * 1000` REST window.

---

### Change 3: Lower `get_candles()` minimum for peak tracking use case

**File:** `src/hynous/data/providers/ws_feeds.py`

**Location:** Line 182

**Current code:**

```python
        if not window or len(window) < 10:
            return None
```

**Problem:** The 10-candle minimum exists because satellite features need a meaningful time series. But peak tracking only needs 1–2 candles. With the current minimum, a freshly-started WS feed (which accumulates candles one per minute) would return `None` for the first 10 minutes, forcing REST fallback unnecessarily.

**Replace with:**

```python
        if not window or len(window) < min(count, 10):
            return None
```

**What changed:** The minimum is now `min(count, 10)`. If the caller asks for `count=2`, the method returns data as soon as 2 candles are available. If the caller asks for `count=70` (satellite), it still requires 10 as the floor. This is backwards-compatible — existing callers pass `count=15` or `count=70`, both > 10, so their behavior is unchanged.

---

### Change 4: Update `_fetch_satellite_candles()` to use the shared helper

**File:** `src/hynous/intelligence/daemon.py`

**Location:** Lines 1780–1782

**Current code:**

```python
        # Try WS candle cache first (populated by MarketDataFeed)
        real = getattr(provider, "_real", provider)
        feed = getattr(real, "_market_feed", None)
```

**Replace with:**

```python
        # Try WS candle cache first (populated by MarketDataFeed)
        feed = self._get_ws_candle_feed()
```

**What changed:** Uses the new shared helper instead of inline getattr. Behavior is identical. Delete the now-unused `provider` assignment at line 1775 only if no other code in the method uses it — **check first**: line 1795 and 1802 use `provider.get_candles()` for REST fallback, so `provider` must stay.

---

## Docstring Update

**File:** `src/hynous/intelligence/daemon.py`

**Location:** Lines 2550–2555 (docstring of `_update_peaks_from_candles`)

**Current docstring:**

```python
        """Enhance MFE/MAE with 1m candle high/low for open positions.

        Polls only miss peaks/troughs between 10s samples. 1m candles
        include the true intra-candle extreme. Called once per minute.
        Only fetches candles for coins with open positions (1 API call each).
        """
```

**Replace with:**

```python
        """Enhance MFE/MAE with 1m candle high/low for open positions.

        Catches peaks/troughs missed between 1s price samples. 1m candles
        include the true intra-candle extreme. Called once per minute.
        Uses WS candle cache when available (zero API calls), falls back
        to REST (1 API call per position) if WS data is insufficient.
        """
```

---

## What NOT to Change

- The candle processing loop (lines 2580–2684) — untouched. ROE calculation, peak/trough updates, capital-BE re-evaluation, persistence all stay exactly as they are.
- The `_loop_inner()` call site (lines 1048–1059) — same 60s interval, same guards.
- The `provider.get_candles()` REST method in `hyperliquid.py` — stays pure REST. The WS-first check lives in the daemon, not the provider (mirrors `_fetch_satellite_candles` pattern).
- Candle format — WS and REST both return `{"t": int, "o": float, "h": float, "l": float, "c": float, "v": float}`. No conversion needed.
- Any other methods or files.

---

## Testing Requirements

### Test File: `tests/unit/test_candle_peak_ws.py`

Create a new test file. Follow the patterns in `test_candle_peak_tracking.py` (pure logic) and `test_ws_price_feed.py` (source inspection).

### Source Helpers

```python
from pathlib import Path


def _daemon_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return path.read_text()


def _ws_feeds_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "data" / "providers" / "ws_feeds.py"
    return path.read_text()


def _get_method(src: str, method_name: str) -> str:
    start = src.find(f"def {method_name}(")
    end = src.find("\n    def ", start + 1)
    return src[start:end] if end != -1 else src[start:]
```

### Static Tests (Source Code Validation)

```
class TestWSCandleFeedHelper:
    test_helper_method_exists()
        # Verify def _get_ws_candle_feed(self) exists in daemon.py

    test_helper_accesses_market_feed()
        # Verify _get_ws_candle_feed contains "_market_feed"

    test_helper_unwraps_paper_provider()
        # Verify _get_ws_candle_feed contains getattr(provider, "_real", provider)

    test_helper_used_in_update_peaks()
        # Verify _update_peaks_from_candles contains _get_ws_candle_feed

    test_helper_used_in_fetch_satellite()
        # Verify _fetch_satellite_candles contains _get_ws_candle_feed
        # (replaces inline getattr chain)

    test_no_inline_getattr_in_fetch_satellite()
        # Verify _fetch_satellite_candles does NOT contain
        # getattr(provider, "_real", provider) — replaced by helper


class TestWSFirstInUpdatePeaks:
    test_ws_candle_check_before_rest()
        # Extract _update_peaks_from_candles method body.
        # Verify feed.get_candles appears BEFORE provider.get_candles
        # (WS check runs first, REST is fallback)

    test_rest_fallback_preserved()
        # Verify provider.get_candles(sym, "1m", start_ms, now_ms) still exists
        # in _update_peaks_from_candles (REST fallback not removed)

    test_ws_candle_count_is_2()
        # Verify feed.get_candles call uses count=2 (not 70 or 15)

    test_feed_fetched_once_outside_loop()
        # Verify _get_ws_candle_feed() call appears BEFORE the
        # "for sym, pos in self._prev_positions" loop, not inside it

    test_docstring_mentions_ws()
        # Verify _update_peaks_from_candles docstring contains "WS"


class TestGetCandlesMinimumFloor:
    test_min_count_formula()
        # Verify ws_feeds.py get_candles uses min(count, 10) not hardcoded 10
        # Read get_candles method body, check for "min(count, 10)"

    test_count_2_returns_with_2_candles()
        # Logic test: with count=2, min(2, 10) = 2.
        # A window with 2 candles satisfies len(window) >= 2.

    test_count_70_still_requires_10()
        # Logic test: with count=70, min(70, 10) = 10.
        # Still needs 10 candles minimum — satellite behavior unchanged.

    test_count_15_still_requires_10()
        # Logic test: with count=15, min(15, 10) = 10.
        # Still needs 10 candles minimum — satellite behavior unchanged.

    test_empty_window_returns_none()
        # Logic test: empty window → None regardless of count.
```

### Candle Format Compatibility Test

```
class TestCandleFormatCompatibility:
    test_ws_and_rest_candle_keys_match()
        # Both WS and REST candles use keys: t, o, h, l, c, v
        # Verify _update_peaks_from_candles only reads "h" and "l"
        # which exist in both formats.

    test_peak_tracking_reads_h_and_l_only()
        # Read _update_peaks_from_candles source.
        # Verify candle field access is candle.get("h", 0) and candle.get("l", 0)
        # No other candle fields are accessed in the peak/trough logic.
```

### Regression Test

```
class TestExistingPeakTrackingUnchanged:
    test_roe_formula_unchanged()
        # Read _update_peaks_from_candles source.
        # Verify the ROE computation lines are still present:
        # "((high - entry_px) / entry_px * 100) * leverage" for long best
        # "((entry_px - low) / entry_px * 100) * leverage" for short best

    test_capital_be_reevaluation_unchanged()
        # Verify "capital_breakeven_enabled" still appears in
        # _update_peaks_from_candles (candle capital-BE block preserved)

    test_persist_on_trailing_active_unchanged()
        # Verify the Bug E fix pattern is intact:
        # "if self._trailing_active.get(sym):" followed by
        # "_persist_mechanical_state()" within _update_peaks_from_candles
```

---

## Running Tests

```bash
cd /Users/bauthoi/Documents/Hynous

# Run new tests
PYTHONPATH=src pytest tests/unit/test_candle_peak_ws.py -v

# Run existing candle peak tests (regression check)
PYTHONPATH=src pytest tests/unit/test_candle_peak_tracking.py -v

# Run WS feed tests (regression check)
PYTHONPATH=src pytest tests/unit/test_ws_price_feed.py -v

# Run full mechanical exit suite (ensure nothing broke)
PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py tests/unit/test_breakeven_fix.py tests/unit/test_trailing_stop_fixes.py tests/unit/test_mechanical_exit_fixes_2.py tests/unit/test_exit_classification.py -v

# Run ALL unit tests
PYTHONPATH=src pytest tests/unit/ -v
```

**All existing tests MUST pass.** If any fail, the implementation has a regression. Stop and report to the architect before continuing.

---

## Verification Checklist

### Code Verification

- [ ] `_get_ws_candle_feed()` method exists in daemon.py, returns `MarketDataFeed | None`
- [ ] `_update_peaks_from_candles()` calls `_get_ws_candle_feed()` once before the position loop
- [ ] WS check (`feed.get_candles(sym, "1m", count=2)`) appears before REST call in the loop
- [ ] REST fallback (`provider.get_candles(sym, "1m", start_ms, now_ms)`) still exists inside `if not candles:`
- [ ] `_fetch_satellite_candles()` uses `_get_ws_candle_feed()` instead of inline getattr
- [ ] `ws_feeds.py` `get_candles()` uses `min(count, 10)` for the minimum floor
- [ ] No other files modified
- [ ] Docstring updated to mention WS

### Regression Verification

- [ ] All 19 existing candle peak tests pass
- [ ] All 53 WS feed tests pass
- [ ] All mechanical exit tests pass (breakeven, trailing, classification, etc.)
- [ ] Full `tests/unit/` suite passes

### Functional Verification (on test VPS)

After deploying to test-env, verify with daemon logs:

```bash
# 1. Confirm WS candles are being used (no REST calls for peak tracking)
# With WS active, you should NOT see "Candle peak tracking failed" debug messages.
# The REST fallback only fires when WS data is unavailable.
journalctl -u hynous-test -n 500 --no-pager | grep -i "candle"

# 2. Confirm peak tracking still works (MFE corrections still logged)
journalctl -u hynous-test -n 500 --no-pager | grep "MFE corrected"

# 3. Confirm WS feed health
# The WS feed should show candle channels in its health output.
# Check dashboard ML page or daemon startup logs for "WS market data feed started"
```

---

## Error Handling

If the engineer encounters issues during implementation:

1. **`get_candles()` returns None with WS active** — The 10-candle minimum (now `min(count, 10)`) may not be the issue. Check if candle subscriptions are active for the coin. The WS must have been running for at least 2 minutes to accumulate 2 candles for `count=2`.

2. **Import errors when testing** — Tests use source inspection (reading `.py` files as text), not imports. If `_daemon_source()` fails, check the relative path in the helper function.

3. **Existing tests break after `get_candles()` minimum change** — The `min(count, 10)` change is backwards-compatible for all existing callers (`count=15` and `count=70`). If a test fails, the issue is elsewhere.

**If any of these occur, stop and report to the architect with the exact error before continuing.**

---

Last updated: 2026-03-15
