# Phase 2: Implementation — Continuous Exponential Retracement

> Apply the calibrated parameters from Phase 1 to the codebase.
>
> **Prerequisites:** Phase 1 complete. 6 calibrated values confirmed by architect.
> **Status:** Ready (after Phase 1)
> **Branch:** `test-env`
> **Files touched:** 5 modified, 1 new test file section

---

## 1. Required Reading

### Must Read (before making any changes)

| File | Lines | What to Understand |
|------|-------|--------------------|
| `src/hynous/intelligence/daemon.py` | 2350–2463 | **The code being changed.** Understand the full trailing stop section: vol regime resolution, activation, tiered retracement, vol modifier, trail ROE computation, floor, price conversion, SL placement. |
| `src/hynous/core/trading_settings.py` | 98–124 | The 7 fields being replaced and the 4 activation fields being kept. |
| `config/default.yaml` | 60–79 | YAML keys that must match Python defaults exactly. |
| `tests/unit/test_ml_adaptive_trailing.py` | All | Every test that references tier/vol_mod fields — these will be updated. |
| `src/hynous/intelligence/prompts/builder.py` | 159–182 | System prompt section describing the trailing stop. |

### Should Read (for context)

| File | Lines | What to Understand |
|------|-------|--------------------|
| `docs/revisions/trailing-stop-fix/README.md` | All | The design rationale and what does/doesn't change. |
| `docs/revisions/trailing-stop-fix/phase-1-calibration.md` | All | The calibration methodology and output. |
| `docs/revisions/breakeven-fix/dynamic-protective-sl.md` | Section 5 | How the dynamic SL implementation was structured — follow the same pattern. |

---

## 2. Notation

Throughout this guide, `CALIBRATED_FLOOR`, `CALIBRATED_AMPLITUDE`, `CALIBRATED_K_EXTREME`, `CALIBRATED_K_HIGH`, `CALIBRATED_K_NORMAL`, `CALIBRATED_K_LOW` refer to the 6 values produced by the Phase 1 calibration script.

**Replace these placeholders with the actual numbers before implementing.**

---

## 3. Implementation Steps

### Step 1: Update `trading_settings.py`

**File:** `src/hynous/core/trading_settings.py`

#### 1a. Replace the tier and vol_mod fields (lines 113–124)

**REMOVE these lines (113–124):**

```python
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

**REPLACE with:**

```python
    # Continuous exponential retracement: r(p) = floor + amplitude * exp(-k * p)
    # where p = peak ROE %. Replaces the 3-tier + vol-modifier system.
    # Vol regime is absorbed into the decay rate k (no separate modifier).
    trail_ret_floor: float = CALIBRATED_FLOOR           # Asymptotic minimum retracement
    trail_ret_amplitude: float = CALIBRATED_AMPLITUDE   # Range: ceiling = floor + amplitude
    trail_ret_k_extreme: float = CALIBRATED_K_EXTREME   # Decay rate in extreme vol (fastest)
    trail_ret_k_high: float = CALIBRATED_K_HIGH         # Decay rate in high vol
    trail_ret_k_normal: float = CALIBRATED_K_NORMAL     # Decay rate in normal vol
    trail_ret_k_low: float = CALIBRATED_K_LOW           # Decay rate in low vol (slowest)
    # Minimum trail distance above fee-BE (guarantees net profit when trail fires).
    trail_min_distance_above_fee_be: float = 0.5        # ROE % above fee-BE floor
```

**Note:** `trail_min_distance_above_fee_be` is kept unchanged at line 124.

**Critical:** The legacy fields `trailing_stop_enabled` (line 102), `trailing_activation_roe` (line 103), and `trailing_retracement_pct` (line 104) are **kept as-is** — they serve as fallback defaults.

#### 1b. Add math import

**File:** `src/hynous/core/trading_settings.py`

Check if `import math` exists at the top of the file. If not, add it after the existing imports. This will be needed if any helper method is added to the dataclass, but the exponential computation itself happens in daemon.py, so this import may not be needed here. Skip if not needed.

---

### Step 2: Update `config/default.yaml`

**File:** `config/default.yaml`

#### 2a. Replace the tier and vol_mod YAML keys (lines 69–79)

**REMOVE these lines (69–79):**

```yaml
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

**REPLACE with:**

```yaml
  # Continuous exponential retracement: r(p) = floor + amplitude * exp(-k * p)
  # Replaces 3-tier + vol-modifier system. k varies by vol regime.
  trail_ret_floor: CALIBRATED_FLOOR
  trail_ret_amplitude: CALIBRATED_AMPLITUDE
  trail_ret_k_extreme: CALIBRATED_K_EXTREME
  trail_ret_k_high: CALIBRATED_K_HIGH
  trail_ret_k_normal: CALIBRATED_K_NORMAL
  trail_ret_k_low: CALIBRATED_K_LOW
  # Minimum trail distance above fee-BE (ROE %)
  trail_min_distance_above_fee_be: 0.5
```

**Critical consistency:** YAML values must match Python dataclass defaults exactly. Verify after writing.

---

### Step 3: Update `daemon.py` — The Core Change

**File:** `src/hynous/intelligence/daemon.py`

#### 3a. Add `import math` at the top

Check if `import math` already exists in the imports section (top of file, typically lines 1–30). If not, add it alongside the other stdlib imports. It is likely already present — verify before adding.

#### 3b. Replace tiered retracement + vol modifier (lines 2390–2406)

This is the core change. Replace 17 lines with 5 lines.

**REMOVE these lines (2390–2406):**

```python
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
```

**REPLACE with:**

```python
                            # ── Continuous exponential retracement ──
                            # r(p) = floor + amplitude * exp(-k * p)
                            # Vol regime absorbed into k (no separate modifier).
                            _k_map = {
                                "extreme": ts.trail_ret_k_extreme,
                                "high": ts.trail_ret_k_high,
                                "normal": ts.trail_ret_k_normal,
                                "low": ts.trail_ret_k_low,
                            }
                            _k = _k_map.get(_vol_regime, ts.trail_ret_k_normal)
                            effective_retracement = ts.trail_ret_floor + ts.trail_ret_amplitude * math.exp(-_k * peak)
```

**What follows (line 2408 onward) stays exactly the same:**

```python
                            trail_roe = peak * (1.0 - effective_retracement)

                            # ── Floor: fee-BE + minimum distance ──
                            trail_floor = fee_be_roe + ts.trail_min_distance_above_fee_be
                            trail_roe = max(trail_roe, trail_floor)
```

**Variables in scope at this point (verify these exist above):**
- `peak` — from `self._peak_roe.get(sym, 0)` (line ~2388)
- `ts` — from `get_trading_settings()` (line ~2355)
- `_vol_regime` — resolved at lines 2359–2365
- `fee_be_roe` — computed at line 2376
- `math` — imported at top of file

**Critical consistency notes:**
- The variable name `effective_retracement` must remain the same — it is used on line 2408 (`trail_roe = peak * (1.0 - effective_retracement)`).
- The `_vol_regime` variable is already resolved at lines 2359–2365 (shared with the activation logic). No changes needed there.
- The `_k_map` dict follows the same pattern as the existing `_activation_map` (lines 2368–2373) and `_vol_mod_map` (lines 2399–2404).

---

### Step 4: Update `prompts/builder.py`

**File:** `src/hynous/intelligence/prompts/builder.py`

#### 4a. Update the trailing stop description (lines 170–172)

**FIND (lines 170–172):**

```python
Trailing stop: Once ROE crosses the activation threshold (adapts to volatility, typically 1.5–3.0%), \
the stop begins trailing at a retracement from peak that tightens as the trade runs further. \
It executes immediately — no wake, no asking me.
```

**REPLACE with:**

```python
Trailing stop: Once ROE crosses the activation threshold (adapts to volatility, typically 1.5–3.0%), \
the stop begins trailing using a continuous exponential curve — retracement tightens smoothly as \
the trade runs further, with the tightening speed calibrated to the current vol regime. \
It executes immediately — no wake, no asking me.
```

This is a description change only. No functional impact.

---

### Step 5: Update Tests

**File:** `tests/unit/test_ml_adaptive_trailing.py`

#### 5a. Update `_NEW_FIELDS` list (lines 257–264)

**FIND (lines 257–264):**

```python
_NEW_FIELDS = [
    "trail_activation_extreme", "trail_activation_high",
    "trail_activation_normal", "trail_activation_low",
    "trail_retracement_tier1", "trail_retracement_tier2", "trail_retracement_tier3",
    "trail_vol_mod_extreme", "trail_vol_mod_high",
    "trail_vol_mod_normal", "trail_vol_mod_low",
    "trail_min_distance_above_fee_be",
]
```

**REPLACE with:**

```python
_NEW_FIELDS = [
    "trail_activation_extreme", "trail_activation_high",
    "trail_activation_normal", "trail_activation_low",
    "trail_ret_floor", "trail_ret_amplitude",
    "trail_ret_k_extreme", "trail_ret_k_high",
    "trail_ret_k_normal", "trail_ret_k_low",
    "trail_min_distance_above_fee_be",
]
```

#### 5b. Update `TestTieredRetracement` class (lines 181–211)

**RENAME** the class to `TestContinuousRetracement` and rewrite the tests.

**REMOVE the entire class (lines 181–211) and REPLACE with:**

```python
class TestContinuousRetracement:
    """Verify continuous exponential retracement replaces discrete tiers."""

    def test_exponential_fields_exist(self):
        """New fields exist in TradingSettings."""
        src = Path("src/hynous/core/trading_settings.py").read_text()
        assert "trail_ret_floor" in src
        assert "trail_ret_amplitude" in src
        assert "trail_ret_k_extreme" in src
        assert "trail_ret_k_high" in src
        assert "trail_ret_k_normal" in src
        assert "trail_ret_k_low" in src

    def test_tier_fields_removed(self):
        """Old tier and vol_mod fields no longer exist."""
        src = Path("src/hynous/core/trading_settings.py").read_text()
        assert "trail_retracement_tier1" not in src
        assert "trail_retracement_tier2" not in src
        assert "trail_retracement_tier3" not in src
        assert "trail_vol_mod_extreme" not in src
        assert "trail_vol_mod_high" not in src
        assert "trail_vol_mod_normal" not in src
        assert "trail_vol_mod_low" not in src

    def test_daemon_uses_math_exp(self):
        """daemon.py uses math.exp for retracement, not if/elif/else tiers."""
        src = Path("src/hynous/intelligence/daemon.py").read_text()
        assert "math.exp" in src
        # Old tier logic should be gone
        assert "trail_retracement_tier1" not in src
        assert "trail_retracement_tier2" not in src
        assert "trail_retracement_tier3" not in src
        assert "trail_vol_mod_extreme" not in src

    def test_k_map_in_daemon(self):
        """daemon.py has a _k_map dict for regime-dependent decay rate."""
        src = Path("src/hynous/intelligence/daemon.py").read_text()
        assert "_k_map" in src
        assert "trail_ret_k_extreme" in src
        assert "trail_ret_k_normal" in src

    def test_trail_floor_unchanged(self):
        """trail_min_distance_above_fee_be is still present and used."""
        src = Path("src/hynous/core/trading_settings.py").read_text()
        assert "trail_min_distance_above_fee_be" in src
        daemon_src = Path("src/hynous/intelligence/daemon.py").read_text()
        assert "trail_min_distance_above_fee_be" in daemon_src
```

#### 5c. Update `TestTieredRetractionFormulas` class (lines 213–252)

**RENAME** to `TestContinuousRetractionFormulas` and rewrite.

**REMOVE the entire class (lines 213–252) and REPLACE with:**

```python
class TestContinuousRetractionFormulas:
    """Verify the exponential retracement formula produces correct values."""

    def test_formula_at_low_peak(self):
        """At peak near activation, retracement should be near ceiling."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        peak = 2.5
        r = floor + amp * math.exp(-k * peak)
        # Should be near 0.45 (the old tier 1 value in normal vol)
        assert 0.35 <= r <= 0.55, f"r({peak}) = {r}, expected ~0.45"

    def test_formula_at_mid_peak(self):
        """At peak ~7.5%, retracement should be near old tier 2."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        peak = 7.5
        r = floor + amp * math.exp(-k * peak)
        # Should be near 0.38 (the old tier 2 value in normal vol)
        assert 0.28 <= r <= 0.48, f"r({peak}) = {r}, expected ~0.38"

    def test_formula_at_high_peak(self):
        """At peak ~12%, retracement should be near old tier 3."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        peak = 12.0
        r = floor + amp * math.exp(-k * peak)
        # Should be near 0.30 (the old tier 3 value in normal vol)
        assert 0.20 <= r <= 0.40, f"r({peak}) = {r}, expected ~0.30"

    def test_monotonically_decreasing(self):
        """Retracement decreases as peak increases."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        prev = 1.0
        for peak in [1.0, 2.0, 3.0, 5.0, 7.5, 10.0, 15.0, 20.0, 30.0]:
            r = floor + amp * math.exp(-k * peak)
            assert r <= prev, f"r({peak}) = {r} > r(prev) = {prev}"
            prev = r

    def test_never_below_floor(self):
        """Retracement never goes below floor, even at extreme peaks."""
        import math
        floor, amp = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE
        for k in [CALIBRATED_K_EXTREME, CALIBRATED_K_HIGH, CALIBRATED_K_NORMAL, CALIBRATED_K_LOW]:
            for peak in [0.0, 5.0, 10.0, 20.0, 50.0, 100.0]:
                r = floor + amp * math.exp(-k * peak)
                assert r >= floor - 1e-9, f"r({peak}) = {r} < floor {floor}"

    def test_extreme_vol_tighter_than_normal(self):
        """In extreme vol (higher k), retracement is lower at same peak."""
        import math
        floor, amp = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE
        for peak in [3.0, 5.0, 7.5, 10.0, 15.0]:
            r_extreme = floor + amp * math.exp(-CALIBRATED_K_EXTREME * peak)
            r_normal = floor + amp * math.exp(-CALIBRATED_K_NORMAL * peak)
            assert r_extreme <= r_normal, (
                f"At peak {peak}: extreme r={r_extreme} > normal r={r_normal}"
            )

    def test_low_vol_looser_than_normal(self):
        """In low vol (lower k), retracement is higher at same peak."""
        import math
        floor, amp = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE
        for peak in [3.0, 5.0, 7.5, 10.0, 15.0]:
            r_low = floor + amp * math.exp(-CALIBRATED_K_LOW * peak)
            r_normal = floor + amp * math.exp(-CALIBRATED_K_NORMAL * peak)
            assert r_low >= r_normal, (
                f"At peak {peak}: low r={r_low} < normal r={r_normal}"
            )

    def test_floor_prevents_low_trail(self):
        """Trail floor (fee_be + min_distance) still applies."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        peak = 2.5  # Low peak
        r = floor + amp * math.exp(-k * peak)
        trail_roe = peak * (1.0 - r)
        fee_be_roe = 0.07 * 20  # 1.4% at 20x
        trail_floor = fee_be_roe + 0.5  # 1.9%
        effective_trail = max(trail_roe, trail_floor)
        assert effective_trail >= trail_floor

    def test_continuous_at_old_boundary_5pct(self):
        """No discontinuity at the old 5% tier boundary."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        r_499 = floor + amp * math.exp(-k * 4.99)
        r_501 = floor + amp * math.exp(-k * 5.01)
        # Change should be tiny (< 0.01), not the old 0.07 jump
        assert abs(r_499 - r_501) < 0.01, (
            f"Discontinuity at 5%: r(4.99)={r_499}, r(5.01)={r_501}, "
            f"delta={abs(r_499 - r_501)}"
        )

    def test_continuous_at_old_boundary_10pct(self):
        """No discontinuity at the old 10% tier boundary."""
        import math
        floor, amp, k = CALIBRATED_FLOOR, CALIBRATED_AMPLITUDE, CALIBRATED_K_NORMAL
        r_999 = floor + amp * math.exp(-k * 9.99)
        r_1001 = floor + amp * math.exp(-k * 10.01)
        assert abs(r_999 - r_1001) < 0.01, (
            f"Discontinuity at 10%: r(9.99)={r_999}, r(10.01)={r_1001}, "
            f"delta={abs(r_999 - r_1001)}"
        )
```

**Note on `CALIBRATED_*` constants:** Define these at the top of the test file after the imports. Replace with the actual calibrated values from Phase 1.

```python
# Calibrated values from Phase 1 (replace with actual results)
CALIBRATED_FLOOR = ???
CALIBRATED_AMPLITUDE = ???
CALIBRATED_K_EXTREME = ???
CALIBRATED_K_HIGH = ???
CALIBRATED_K_NORMAL = ???
CALIBRATED_K_LOW = ???
```

#### 5d. Update `TestConfigFields` class (lines 254–284)

**Update `test_yaml_has_new_fields` (line 272)** to check for the new YAML keys:

```python
    def test_yaml_has_new_fields(self):
        """default.yaml contains all new trailing stop fields."""
        yaml_text = Path("config/default.yaml").read_text()
        for field_name in [
            "trail_ret_floor", "trail_ret_amplitude",
            "trail_ret_k_extreme", "trail_ret_k_high",
            "trail_ret_k_normal", "trail_ret_k_low",
            "trail_min_distance_above_fee_be",
        ]:
            assert field_name in yaml_text, f"Missing in YAML: {field_name}"
```

Also update **`test_all_new_fields_in_trading_settings` (line 266)** to use the updated `_NEW_FIELDS` list (already done in step 5a).

#### 5e. Verify `TestExistingBehaviorUnchanged` class (lines 290–326)

These tests verify that Phase 2 SL placement, Phase 3 backup close, persist calls, classification, and breakeven layers are unchanged. **These tests should pass without modification.** If any fail, something was accidentally changed — investigate before proceeding.

---

### Step 6: Run All Tests

#### 6a. Static verification (should pass after code changes)

```bash
# From project root
PYTHONPATH=src pytest tests/unit/test_ml_adaptive_trailing.py -v
```

**Expected:** All tests pass. The `TestContinuousRetracement` and `TestContinuousRetractionFormulas` classes validate the new system. The `TestExistingBehaviorUnchanged` class confirms nothing else was broken.

#### 6b. Full trailing/mechanical exit suite

```bash
PYTHONPATH=src pytest tests/unit/test_ml_adaptive_trailing.py \
                      tests/unit/test_dynamic_protective_sl.py \
                      tests/unit/test_breakeven_fix.py \
                      tests/unit/test_mechanical_exit_fixes_2.py \
                      tests/unit/test_mechanical_exits.py \
                      tests/unit/test_trailing_stop_fixes.py -v
```

**Expected:** All tests pass. If any test in `test_dynamic_protective_sl.py`, `test_breakeven_fix.py`, `test_mechanical_exit_fixes_2.py`, `test_mechanical_exits.py`, or `test_trailing_stop_fixes.py` fails, something was accidentally affected — **STOP and investigate**.

#### 6c. Full test suite

```bash
PYTHONPATH=src pytest tests/ -v
```

**Expected:** All 795+ tests pass. Report the total count.

---

## 4. Post-Implementation Verification

### 4a. Config consistency check

Manually verify that the Python defaults and YAML values match exactly:

| Field | Python default | YAML value | Match? |
|-------|----------------|------------|--------|
| `trail_ret_floor` | ??? | ??? | ??? |
| `trail_ret_amplitude` | ??? | ??? | ??? |
| `trail_ret_k_extreme` | ??? | ??? | ??? |
| `trail_ret_k_high` | ??? | ??? | ??? |
| `trail_ret_k_normal` | ??? | ??? | ??? |
| `trail_ret_k_low` | ??? | ??? | ??? |
| `trail_min_distance_above_fee_be` | 0.5 | 0.5 | Yes |

### 4b. Old field cleanup check

Verify the old fields are fully removed:

```bash
# These should return NO matches (except in test files checking removal,
# docs, and git history)
grep -rn "trail_retracement_tier1" src/ config/
grep -rn "trail_retracement_tier2" src/ config/
grep -rn "trail_retracement_tier3" src/ config/
grep -rn "trail_vol_mod_extreme" src/ config/
grep -rn "trail_vol_mod_high" src/ config/
grep -rn "trail_vol_mod_normal" src/ config/
grep -rn "trail_vol_mod_low" src/ config/
```

**Expected:** No matches in `src/` or `config/`. Matches in `tests/` (the removal-check test) and `docs/` (historical docs) are fine.

### 4c. Mechanical state persistence check

Verify that `_persist_mechanical_state()` and `_load_mechanical_state()` are unchanged:

```bash
grep -n "persist_mechanical_state\|load_mechanical_state" src/hynous/intelligence/daemon.py
```

**Expected:** Same line numbers as before. These functions should not have been modified.

### 4d. System prompt check

Read `src/hynous/intelligence/prompts/builder.py` lines 170–172 and verify the updated text mentions "continuous exponential curve" instead of "retracement from peak that tightens as the trade runs further."

---

## 5. What to Report

After completing all steps and tests:

### 5a. Test results

```
test_ml_adaptive_trailing.py:  ??? passed
test_dynamic_protective_sl.py: ??? passed
test_breakeven_fix.py:         ??? passed
test_mechanical_exit_fixes_2.py: ??? passed
test_mechanical_exits.py:      ??? passed
test_trailing_stop_fixes.py:   ??? passed
─────────────────────────────────────────
Total:                         ??? passed, 0 failed
```

### 5b. Config consistency

All 7 fields match between Python and YAML: YES/NO

### 5c. Old field cleanup

No references to old fields in `src/` or `config/`: YES/NO

### 5d. Issues encountered

List any issues, unexpected test failures, or deviations from this guide.

---

## 6. Rollback Plan

If the new system needs to be reverted:

1. **Revert the daemon.py change** — restore the if/elif/else + vol_modifier block
2. **Revert trading_settings.py** — restore the 7 tier/vol_mod fields
3. **Revert default.yaml** — restore the tier/vol_mod YAML keys
4. **Re-run tests** — all 795+ should pass

The trailing stop is guarded by `config.daemon.trailing_stop_enabled` (YAML) and `ts.trailing_stop_enabled` (TradingSettings). Setting either to `false` disables the entire trailing system as a quick kill switch, without reverting code.

---

## 7. File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/hynous/core/trading_settings.py` | Modified | Replace 7 fields with 6 fields |
| `config/default.yaml` | Modified | Replace 7 YAML keys with 6 keys |
| `src/hynous/intelligence/daemon.py` | Modified | Replace if/elif/else + vol_modifier (~17 lines) with exp() (~5 lines) |
| `src/hynous/intelligence/prompts/builder.py` | Modified | Update trailing stop description text (3 lines) |
| `tests/unit/test_ml_adaptive_trailing.py` | Modified | Rewrite tier/vol_mod tests to continuous/exp tests |
| `satellite/experiments/exp_trailing_calibration.py` | New (Phase 1) | Calibration script |

---

Last updated: 2026-03-18
