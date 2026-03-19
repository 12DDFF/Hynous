> ⚠️ **SUPERSEDED by Adaptive Trailing Stop v3 (2026-03-18).** The tiered retracement + vol modifier system described below has been replaced by a continuous exponential function with regime-dependent decay rate: `r(p) = 0.20 + 0.30 × exp(-k × p)` where k varies by vol regime (extreme=0.160, high=0.100, normal=0.080, low=0.040). The agent exit lockout and vol-adaptive activation thresholds from this document remain unchanged and are still active. See `docs/revisions/trailing-stop-fix/` for the current design.

---

# ML-Adaptive Trailing Stop + Agent Exit Lockout (v2 — Superseded)

> **Status:** Implemented (2026-03-15) — superseded by v3 (2026-03-18)
> **Priority:** High — agent override is the #1 source of lost profit
> **Branch:** `test-env`
> **Files touched:** `src/hynous/intelligence/daemon.py`, `src/hynous/intelligence/tools/trading.py`, `src/hynous/core/trading_settings.py`, `src/hynous/intelligence/prompts/builder.py`, `config/default.yaml`

---

## Required Reading Before Starting

Read ALL of these before writing a single line of code. Do not skip any.

1. **`CLAUDE.md`** (project root) — codebase conventions, testing instructions (`PYTHONPATH=src pytest tests/`)
2. **`docs/revisions/breakeven-fix/README.md`** — two-layer breakeven design; the trailing stop sits on top of this system
3. **`src/hynous/intelligence/daemon.py`** — read specifically:
   - `__init__` state dicts (lines 341–349) — `_trailing_active`, `_trailing_stop_px`, `_peak_roe`, `_breakeven_set`, `_capital_be_set`
   - `_fast_trigger_check()` (lines 2043–2547) — the 1s loop; contains ALL mechanical exit logic
   - Trailing stop block (lines 2306–2488) — Phase 1/2/3; this is what you are modifying
   - `_latest_predictions` cache (line 432, set at lines 1684 and 1721) — ML conditions available in-process
   - `get_peak_roe()` / `get_trough_roe()` (lines 781–787) — public accessors; pattern for adding `is_trailing_active()`
4. **`src/hynous/intelligence/tools/trading.py`** — read specifically:
   - `handle_close_position()` (lines 1502–1542) — the function you are adding the lockout to
   - `_get_ml_conditions()` (lines 120–137) — how daemon ML data is accessed from tools
   - `get_active_daemon` usage (lines 126, 153, 614, 1139, 1732) — import pattern for daemon state access
5. **`src/hynous/core/trading_settings.py`** — `TradingSettings` dataclass (lines 98–130); trailing stop fields you will extend
6. **`src/hynous/intelligence/prompts/builder.py`** — MECHANICAL EXIT SYSTEM section (lines 159–175); `profit_taking` variable (line 196)
7. **`config/default.yaml`** — daemon section (lines 58–61); current trailing stop values
8. **`tests/unit/test_mechanical_exits.py`** — existing trailing stop tests; your new tests must follow the same style
9. **`tests/unit/test_breakeven_fix.py`** — source inspection test patterns (`_daemon_source()`, `_get_method()`)

---

## Context — Why This Change

Evidence from production trade data (Nous query, 2026-03-15):

| Trade | Peak ROE | Exit ROE | close_type | Problem |
|-------|----------|----------|------------|---------|
| SOL LONG | +11.72% | -0.18% | `"full"` (agent close) | Agent panicked, gave back 100% of peak |
| BTC LONG | +7.31% | +2.6% | `"trailing_stop"` | Trail worked but 50% retracement gave back too much |
| SOL LONG | +3.21% | +0.20% | `"trailing_stop"` | Trail captured almost nothing — netted $0.21 |

**Two problems, two fixes:**
1. The agent overrides mechanical exits by calling `close_position` — must be blocked when trailing is active
2. The fixed 2.8% activation and 50% retracement don't adapt to market conditions — must be ML-adaptive

---

## Part 1: Agent Exit Lockout

### Change 1A: Add `is_trailing_active()` accessor to daemon

**File:** `src/hynous/intelligence/daemon.py`

**Location:** After `get_trough_roe()` method (after line 787)

**Add:**

```python
    def is_trailing_active(self, coin: str) -> bool:
        """Check if trailing stop is currently active for a position."""
        return self._trailing_active.get(coin, False)
```

This follows the exact pattern of `get_peak_roe()` (line 781) and `get_trough_roe()` (line 785).

---

### Change 1B: Add lockout check in `handle_close_position()`

**File:** `src/hynous/intelligence/tools/trading.py`

**Location:** After line 1542 (after position existence is confirmed, before limit close validation). The position lookup succeeds at this point, and `position` is a valid dict.

**Add this block:**

```python
    # --- Trailing stop lockout: agent cannot close when trail is active ---
    # Once the trailing stop activates, the mechanical system owns the exit.
    # The agent's job is entries only — exits are fully mechanical.
    try:
        from ...intelligence.daemon import get_active_daemon
        _daemon = get_active_daemon()
        if _daemon and _daemon.is_trailing_active(symbol):
            trail_px = _daemon._trailing_stop_px.get(symbol, 0)
            peak = _daemon.get_peak_roe(symbol)
            _record_trade_span(
                "close_position", "trailing_lockout", False,
                f"BLOCKED: trailing stop active (peak {peak:.1f}%, trail @ ${trail_px:,.2f})",
            )
            return (
                f"BLOCKED: Trailing stop is active for {symbol}. "
                f"The mechanical exit system owns this position "
                f"(peak ROE {peak:+.1f}%, trail SL @ ${trail_px:,.2f}). "
                f"You cannot close manually while the trail is active. "
                f"The trailing stop will exit when the price reverses to the trail level."
            )
    except Exception:
        pass  # If daemon unavailable, allow the close (safety fallback)
```

**Why this location:** The position is confirmed to exist (line 1532 check passed), so we know the symbol is valid. The trailing-active check happens before any market_close execution, so no side effects if blocked.

**Why `force` is NOT checked:** The `force` parameter is deprecated (tool schema line 1490: "Deprecated — no longer has any effect"). The trailing stop lockout is unconditional — the mechanical system's authority over exits is absolute once the trail activates.

**Safety fallback:** If `get_active_daemon()` returns None (daemon not running) or throws, the check is skipped and the close proceeds normally. This ensures the lockout never prevents emergency closes when the daemon is down.

---

### Change 1C: Update system prompt

**File:** `src/hynous/intelligence/prompts/builder.py`

**Location:** Lines 159–175 (MECHANICAL EXIT SYSTEM section)

**Replace the entire section with:**

```python
f"""**MECHANICAL EXIT SYSTEM:** My exits are handled by code, not by me.

Breakeven stop: Once I clear fee break-even ROE ({ts.taker_fee_pct * ts.micro_leverage:.1f}% at \
{ts.micro_leverage}x, scales with leverage), the daemon moves my SL to entry + fee buffer. \
This trade is now risk-free.

Trailing stop: Once ROE crosses the activation threshold (adapts to volatility, typically 1.5–3.0%), \
the stop begins trailing at a retracement from peak that tightens as the trade runs further. \
It executes immediately — no wake, no asking me.

EXIT LOCKOUT: Once the trailing stop activates, I CANNOT close the position. The system will \
reject my close_position call. This is by design — I was overriding the mechanical system and \
losing money by panic-closing winners. The trailing stop will exit at the right time.

Stop lockout: I can TIGHTEN my stops (move closer to price) but I CANNOT widen or remove \
mechanical stops. The system enforces this — trying to widen will be blocked.

My job is ENTRIES: direction, symbol, conviction, sizing, initial SL/TP, thesis. \
Everything after entry is mechanical. I accept the trailing stop's exit unconditionally."""
```

**Also replace the `profit_taking` variable at line 196 with:**

```python
    profit_taking = """**Exit management is mechanical and I cannot override it.** Once my trailing stop activates, the position is locked — I cannot close it manually. The breakeven stop protects capital, the trailing stop locks in profit. I focus entirely on finding the next good entry."""
```

---

## Part 2: ML-Adaptive Trailing Stop

### Change 2A: Add new config fields to TradingSettings

**File:** `src/hynous/core/trading_settings.py`

**Location:** After line 104 (after `trailing_retracement_pct`). Insert these fields:

```python
    # --- ML-Adaptive Trailing Stop ---
    # Vol-regime activation: lower activation in high vol (moves are real),
    # higher in low vol (need more confirmation).
    trail_activation_extreme: float = 1.5   # Activation ROE % in extreme vol
    trail_activation_high: float = 2.0      # Activation ROE % in high vol
    trail_activation_normal: float = 2.5    # Activation ROE % in normal vol
    trail_activation_low: float = 3.0       # Activation ROE % in low vol
    # Tiered retracement: tighter as the trade runs further.
    # Values are the retracement % (how much of peak to give back).
    trail_retracement_tier1: float = 45.0   # Retracement % for peak 0–5% ROE
    trail_retracement_tier2: float = 38.0   # Retracement % for peak 5–10% ROE
    trail_retracement_tier3: float = 30.0   # Retracement % for peak 10%+ ROE
    # Vol-regime modifier on retracement (multiplied against tier value).
    trail_vol_mod_extreme: float = 0.75     # Tighten 25% in extreme vol
    trail_vol_mod_high: float = 0.88        # Tighten 12% in high vol
    trail_vol_mod_normal: float = 1.0       # No change in normal vol
    trail_vol_mod_low: float = 1.1          # Loosen 10% in low vol
    # Minimum trail distance above fee-BE (guarantees net profit when trail fires).
    trail_min_distance_above_fee_be: float = 0.5  # ROE % above fee-BE floor
```

**Note:** The existing `trailing_activation_roe` (line 103) and `trailing_retracement_pct` (line 104) remain as legacy fallbacks. The new fields take priority when ML data is available; the old fields are used when ML is unavailable (see Change 2B).

---

### Change 2B: Rewrite trailing stop Phase 1 and Phase 2 logic

**File:** `src/hynous/intelligence/daemon.py`

**Location:** Replace lines 2314–2337 (from `ts = get_trading_settings()` through `trail_roe = max(trail_roe, fee_be_roe)`).

**Current code (lines 2314–2337):**

```python
                    ts = get_trading_settings()
                    if ts.trailing_stop_enabled:
                        activation_roe = ts.trailing_activation_roe
                        retracement_pct = ts.trailing_retracement_pct / 100.0
                        peak = self._peak_roe.get(sym, 0)

                        # Phase 1: Check if trail should activate
                        if not self._trailing_active.get(sym) and roe_pct >= activation_roe:
                            self._trailing_active[sym] = True
                            self._persist_mechanical_state()
                            logger.info(
                                "Trailing stop ACTIVATED: %s %s | ROE %.1f%% >= %.1f%% threshold",
                                sym, side, roe_pct, activation_roe,
                            )

                        # Phase 2: Update trailing stop price (only if active)
                        if self._trailing_active.get(sym) and peak > 0:
                            # Trail ROE = peak * (1 - retracement)
                            trail_roe = peak * (1.0 - retracement_pct)

                            # Floor: never trail below breakeven (fee break-even ROE)
                            fee_be_roe = ts.taker_fee_pct * leverage
                            trail_roe = max(trail_roe, fee_be_roe)
```

**Replace with:**

```python
                    ts = get_trading_settings()
                    if ts.trailing_stop_enabled:
                        peak = self._peak_roe.get(sym, 0)

                        # ── Resolve vol regime from ML conditions (BTC only, 5-min refresh) ──
                        # Falls back to "normal" for non-BTC coins or stale/missing predictions.
                        _vol_regime = "normal"
                        _pred = self._latest_predictions.get("BTC", {})
                        _cond = _pred.get("conditions", {})
                        if _cond:
                            _cond_ts = _cond.get("timestamp", 0)
                            if time.time() - _cond_ts < 330:  # Fresh within staleness threshold
                                _vol_regime = _cond.get("vol_1h", {}).get("regime", "normal")

                        # ── Vol-adaptive activation threshold ──
                        _activation_map = {
                            "extreme": ts.trail_activation_extreme,
                            "high": ts.trail_activation_high,
                            "normal": ts.trail_activation_normal,
                            "low": ts.trail_activation_low,
                        }
                        activation_roe = _activation_map.get(_vol_regime, ts.trail_activation_normal)
                        # Floor: never activate below fee-BE + minimum distance
                        fee_be_roe = ts.taker_fee_pct * leverage
                        activation_roe = max(activation_roe, fee_be_roe + 0.1)

                        # Phase 1: Check if trail should activate
                        if not self._trailing_active.get(sym) and roe_pct >= activation_roe:
                            self._trailing_active[sym] = True
                            self._persist_mechanical_state()
                            logger.info(
                                "Trailing stop ACTIVATED: %s %s | ROE %.1f%% >= %.1f%% threshold (vol=%s)",
                                sym, side, roe_pct, activation_roe, _vol_regime,
                            )

                        # Phase 2: Update trailing stop price (only if active)
                        if self._trailing_active.get(sym) and peak > 0:
                            # ── Tiered retracement: tighter as trade runs further ──
                            if peak < 5.0:
                                base_retracement = ts.trail_retracement_tier1 / 100.0
                            elif peak < 10.0:
                                base_retracement = ts.trail_retracement_tier2 / 100.0
                            else:
                                base_retracement = ts.trail_retracement_tier3 / 100.0

                            # ── Vol-regime modifier ──
                            _vol_mod_map = {
                                "extreme": ts.trail_vol_mod_extreme,
                                "high": ts.trail_vol_mod_high,
                                "normal": ts.trail_vol_mod_normal,
                                "low": ts.trail_vol_mod_low,
                            }
                            vol_modifier = _vol_mod_map.get(_vol_regime, ts.trail_vol_mod_normal)
                            effective_retracement = base_retracement * vol_modifier

                            trail_roe = peak * (1.0 - effective_retracement)

                            # ── Floor: fee-BE + minimum distance ──
                            trail_floor = fee_be_roe + ts.trail_min_distance_above_fee_be
                            trail_roe = max(trail_roe, trail_floor)
```

**Everything after this point (line 2338 onward — trail price conversion, should_update check, Phase 2 SL placement, Phase 3 backup close) stays EXACTLY as-is.** Do not modify the cancel-place-rollback logic, the persistence calls, the zombie cleanup, or Phase 3.

---

### Change 2C: Add defaults to `default.yaml`

**File:** `config/default.yaml`

**Location:** After line 61 (`trailing_retracement_pct: 50.0`). Add:

```yaml
  # ML-adaptive trailing stop parameters
  # Vol-regime activation thresholds (ROE % — lower = activates earlier)
  trail_activation_extreme: 1.5
  trail_activation_high: 2.0
  trail_activation_normal: 2.5
  trail_activation_low: 3.0
  # Tiered retracement (% of peak to give back — lower = keeps more profit)
  trail_retracement_tier1: 45.0       # Peak 0-5% ROE
  trail_retracement_tier2: 38.0       # Peak 5-10% ROE
  trail_retracement_tier3: 30.0       # Peak 10%+ ROE
  # Vol modifier on retracement (multiplied — lower = tighter trail)
  trail_vol_mod_extreme: 0.75
  trail_vol_mod_high: 0.88
  trail_vol_mod_normal: 1.0
  trail_vol_mod_low: 1.1
  # Minimum trail distance above fee-BE (ROE %)
  trail_min_distance_above_fee_be: 0.5
```

---

## What NOT to Change

- Phase 2 SL placement logic (cancel-place-rollback) — untouched
- Phase 3 backup close — untouched
- `_persist_mechanical_state()` call sites — untouched
- Breakeven layers (capital-BE, fee-BE) — untouched
- Candle peak tracking — untouched
- Small wins interaction — untouched
- `_override_sl_classification()` — untouched
- Stop-tightening lockout in `handle_modify_position()` — untouched
- Any WS feed code — untouched
- The existing `trailing_activation_roe` and `trailing_retracement_pct` fields in TradingSettings — kept as legacy fallbacks

---

## Testing Requirements

### Test File: `tests/unit/test_ml_adaptive_trailing.py`

### Source Helpers

```python
from pathlib import Path


def _daemon_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "daemon.py"
    return path.read_text()


def _trading_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "tools" / "trading.py"
    return path.read_text()


def _settings_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "core" / "trading_settings.py"
    return path.read_text()


def _builder_source() -> str:
    path = Path(__file__).parent.parent.parent / "src" / "hynous" / "intelligence" / "prompts" / "builder.py"
    return path.read_text()


def _get_method(src: str, method_name: str) -> str:
    start = src.find(f"def {method_name}(")
    end = src.find("\n    def ", start + 1)
    return src[start:end] if end != -1 else src[start:]


def _default_yaml() -> dict:
    import yaml
    path = Path(__file__).parent.parent.parent / "config" / "default.yaml"
    with open(path) as f:
        return yaml.safe_load(f)
```

### Part 1 Tests: Agent Exit Lockout

```
class TestIsTrailingActiveAccessor:
    test_method_exists()
        # Verify def is_trailing_active(self, coin: str) exists in daemon.py

    test_returns_bool()
        # Verify method body contains "return self._trailing_active.get(coin, False)"


class TestExitLockoutInClosePosition:
    test_lockout_check_exists()
        # Read handle_close_position body.
        # Verify "is_trailing_active" appears in the method.

    test_lockout_returns_blocked_message()
        # Verify "BLOCKED" and "trailing stop is active" appear in the method.

    test_lockout_before_market_close()
        # Verify "is_trailing_active" appears BEFORE "market_close" in handle_close_position

    test_lockout_has_safety_fallback()
        # Verify the lockout block is wrapped in try/except (safety: daemon unavailable)

    test_lockout_records_trade_span()
        # Verify "_record_trade_span" appears near "trailing_lockout" string


class TestPromptUpdated:
    test_exit_lockout_in_system_prompt()
        # Read builder.py. Verify "EXIT LOCKOUT" or "CANNOT close" appears
        # in the MECHANICAL EXIT SYSTEM section.

    test_profit_taking_mentions_lockout()
        # Verify profit_taking variable mentions "cannot override" or "locked"
```

### Part 2 Tests: ML-Adaptive Parameters

```
class TestAdaptiveActivation:
    test_vol_regime_read_from_predictions()
        # Read _fast_trigger_check body.
        # Verify "_latest_predictions" is accessed in the trailing stop block.

    test_activation_map_has_four_regimes()
        # Verify "trail_activation_extreme", "trail_activation_high",
        # "trail_activation_normal", "trail_activation_low" all appear
        # in _fast_trigger_check.

    test_activation_floor_above_fee_be()
        # Verify "max(activation_roe, fee_be_roe" appears in trailing block
        # (activation never below fee-BE + buffer)

    test_staleness_check_on_conditions()
        # Verify "330" (staleness threshold) appears near conditions access
        # in the trailing stop block.

    test_fallback_to_normal_without_ml()
        # Verify '_vol_regime = "normal"' is the default before ML check


class TestTieredRetracement:
    test_three_tiers_exist()
        # Verify "trail_retracement_tier1", "trail_retracement_tier2",
        # "trail_retracement_tier3" appear in _fast_trigger_check.

    test_tier_boundaries()
        # Verify "peak < 5.0" and "peak < 10.0" appear in trailing block
        # (tier 1: 0-5%, tier 2: 5-10%, tier 3: 10%+)

    test_vol_modifier_applied()
        # Verify "effective_retracement = base_retracement * vol_modifier"
        # appears in trailing block.

    test_trail_floor_includes_min_distance()
        # Verify "trail_min_distance_above_fee_be" appears in trailing block
        # and is added to fee_be_roe for the floor.


class TestTieredRetractionFormulas:
    test_tier1_normal_vol()
        # peak=4%, tier1=45%, vol_mod=1.0 → retracement=0.45
        # trail_roe = 4.0 * (1 - 0.45) = 2.2%
        peak, ret, mod = 4.0, 0.45, 1.0
        trail = peak * (1.0 - ret * mod)
        assert abs(trail - 2.2) < 0.01

    test_tier2_high_vol()
        # peak=7%, tier2=38%, vol_mod=0.88 → effective=0.3344
        # trail_roe = 7.0 * (1 - 0.3344) = 4.66%
        peak, ret, mod = 7.0, 0.38, 0.88
        trail = peak * (1.0 - ret * mod)
        assert abs(trail - 4.66) < 0.01

    test_tier3_extreme_vol()
        # peak=12%, tier3=30%, vol_mod=0.75 → effective=0.225
        # trail_roe = 12.0 * (1 - 0.225) = 9.30%
        peak, ret, mod = 12.0, 0.30, 0.75
        trail = peak * (1.0 - ret * mod)
        assert abs(trail - 9.30) < 0.01

    test_floor_prevents_low_trail()
        # peak=2.5%, tier1=45%, vol_mod=1.0 → trail=1.375%
        # fee_be=1.4%, min_distance=0.5 → floor=1.9%
        # max(1.375, 1.9) = 1.9%
        trail = 2.5 * (1.0 - 0.45)
        floor = 1.4 + 0.5
        result = max(trail, floor)
        assert abs(result - 1.9) < 0.01

    test_extreme_vol_activation()
        # extreme regime → activation=1.5%
        # fee_be at 20x = 1.4%, floor = 1.4+0.1 = 1.5%
        # max(1.5, 1.5) = 1.5%
        activation = 1.5
        floor = 0.07 * 20 + 0.1
        assert max(activation, floor) == 1.5

    test_low_vol_activation()
        # low regime → activation=3.0%, floor=1.5%
        # max(3.0, 1.5) = 3.0%
        activation = 3.0
        floor = 0.07 * 20 + 0.1
        assert max(activation, floor) == 3.0


class TestConfigFields:
    test_all_new_fields_in_trading_settings()
        # Verify all 13 new fields exist in TradingSettings dataclass
        src = _settings_source()
        for field in [
            "trail_activation_extreme", "trail_activation_high",
            "trail_activation_normal", "trail_activation_low",
            "trail_retracement_tier1", "trail_retracement_tier2", "trail_retracement_tier3",
            "trail_vol_mod_extreme", "trail_vol_mod_high",
            "trail_vol_mod_normal", "trail_vol_mod_low",
            "trail_min_distance_above_fee_be",
        ]:
            assert field in src, f"{field} missing from TradingSettings"

    test_yaml_has_new_fields()
        cfg = _default_yaml()
        # New fields should be readable (they may be in daemon section
        # or in trading_settings depending on implementation)

    test_legacy_fields_preserved()
        # Verify trailing_activation_roe and trailing_retracement_pct
        # still exist in TradingSettings (kept as fallbacks)
        src = _settings_source()
        assert "trailing_activation_roe" in src
        assert "trailing_retracement_pct" in src
```

### Regression Tests

```
class TestExistingBehaviorUnchanged:
    test_phase2_sl_placement_unchanged()
        # Verify the cancel-place-rollback pattern still exists after trail_roe calculation
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "old_sl_info = None" in method
        assert "CRITICAL: Failed to restore old SL" in method

    test_phase3_backup_close_unchanged()
        # Verify Phase 3 still exists with market_close
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "trail_hit" in method
        assert "market_close(sym)" in method

    test_persist_calls_unchanged()
        # Verify _persist_mechanical_state() still called after:
        # Phase 1 activation, Phase 2 update, Phase 3 close
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert method.count("_persist_mechanical_state()") >= 3

    test_classification_unchanged()
        # _override_sl_classification still handles trailing_stop
        src = _daemon_source()
        method = _get_method(src, "_override_sl_classification")
        assert '"trailing_stop"' in method

    test_breakeven_layers_unchanged()
        # Capital-BE and fee-BE blocks still exist
        src = _daemon_source()
        method = _get_method(src, "_fast_trigger_check")
        assert "capital_breakeven_enabled" in method
        assert "breakeven_stop_enabled" in method
```

---

## Running Tests

```bash
cd /Users/bauthoi/Documents/Hynous

# Run new tests
PYTHONPATH=src pytest tests/unit/test_ml_adaptive_trailing.py -v

# Run ALL existing mechanical exit tests (regression check)
PYTHONPATH=src pytest tests/unit/test_mechanical_exits.py -v
PYTHONPATH=src pytest tests/unit/test_breakeven_fix.py -v
PYTHONPATH=src pytest tests/unit/test_trailing_stop_fixes.py -v
PYTHONPATH=src pytest tests/unit/test_mechanical_exit_fixes_2.py -v
PYTHONPATH=src pytest tests/unit/test_exit_classification.py -v
PYTHONPATH=src pytest tests/unit/test_candle_peak_tracking.py -v
PYTHONPATH=src pytest tests/unit/test_candle_peak_ws.py -v

# Run ALL unit tests
PYTHONPATH=src pytest tests/unit/ -v
```

**All existing tests MUST pass.** If any fail, the implementation has a regression. Stop and report to the architect before continuing.

---

## Verification Checklist

### Part 1: Exit Lockout

- [ ] `is_trailing_active(coin)` method exists in daemon.py, returns bool
- [ ] `handle_close_position()` checks `is_trailing_active(symbol)` before any execution
- [ ] Lockout returns "BLOCKED" message with trail price and peak ROE
- [ ] Lockout is wrapped in try/except (safety: daemon unavailable → allow close)
- [ ] Lockout check appears BEFORE `market_close` in the function
- [ ] `_record_trade_span` logs the lockout event
- [ ] System prompt mentions EXIT LOCKOUT
- [ ] `profit_taking` variable mentions "cannot override"

### Part 2: ML-Adaptive Parameters

- [ ] Vol regime read from `_latest_predictions["BTC"]["conditions"]["vol_1h"]["regime"]`
- [ ] Staleness check (330s) before using conditions
- [ ] Fallback to `"normal"` when ML unavailable, stale, or non-BTC coin
- [ ] Activation threshold selected from 4-regime map
- [ ] Activation floor: `max(activation_roe, fee_be_roe + 0.1)`
- [ ] Three retracement tiers: peak < 5%, peak < 10%, peak ≥ 10%
- [ ] Vol modifier multiplied against tier base
- [ ] Trail floor: `fee_be_roe + trail_min_distance_above_fee_be`
- [ ] All 13 new fields in TradingSettings with correct defaults
- [ ] YAML defaults match Python defaults
- [ ] Legacy `trailing_activation_roe` and `trailing_retracement_pct` preserved

### Regression

- [ ] All existing mechanical exit tests pass
- [ ] Phase 2 SL placement + rollback unchanged
- [ ] Phase 3 backup close unchanged
- [ ] Persist calls unchanged (≥3 in trailing block)
- [ ] Breakeven layers untouched
- [ ] Classification unchanged

---

## Functional Verification (on test VPS)

After deploying to test-env:

```bash
# 1. Verify trailing stop activates with vol-adaptive threshold
journalctl -u hynous-test -n 500 --no-pager | grep "Trailing stop ACTIVATED"
# Should show "vol=normal" or "vol=high" etc. in the log line

# 2. Verify agent lockout works
# Open chat, enter a trade, wait for trail to activate, then ask agent to close
# Agent should receive BLOCKED message

# 3. Check trail captures more profit than before
# Compare exit ROE vs peak ROE on trailing_stop closes
ssh root@89.167.50.168 "curl -s 'http://localhost:3101/v1/nodes?subtype=custom:trade_close&limit=10'" | python3 -c "
import json, sys
data = json.load(sys.stdin)['data']
for d in data:
    sigs = json.loads(d['content_body']).get('signals', {})
    if sigs.get('close_type') == 'trailing_stop':
        peak = sigs.get('mfe_pct', 0)
        exit_roe = sigs.get('lev_return_pct', 0)
        print(f'{sigs[\"symbol\"]} peak={peak:.1f}% exit={exit_roe:.1f}% captured={exit_roe/peak*100:.0f}%' if peak > 0 else '')
"
```

---

## Error Handling

If the engineer encounters issues:

1. **Import error for `get_active_daemon`**: The import path depends on the file's location in the package. In `trading.py` it's `from ...intelligence.daemon import get_active_daemon`. Check existing import at line 1139 for the exact pattern.

2. **`_latest_predictions` is empty**: This is normal when satellite is disabled or in the first 5 minutes after daemon start. The code falls back to `"normal"` regime. Do not treat this as an error.

3. **Existing tests break on activation threshold**: Tests that check for the exact string `"trailing_activation_roe"` in `_fast_trigger_check` may fail since the old single-value activation is replaced by the regime map. Update those tests to check for `"trail_activation_normal"` instead.

4. **Trail fires at unexpected ROE**: The new tiered retracement and vol modifiers change the math. Verify by computing: `effective_retracement = tier_base * vol_modifier`, `trail_roe = peak * (1 - effective_retracement)`, `trail_roe = max(trail_roe, fee_be + min_distance)`.

**If any of these occur, stop and report to the architect with the exact error before continuing.**

---

Last updated: 2026-03-15
