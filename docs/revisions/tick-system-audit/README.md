# Tick System Audit — Train/Inference Mismatch + Integration Issues

> **Status:** All 6 issues fixed (2026-03-31)
> **Date:** 2026-03-30
> **Scope:** 6 issues across 6 files. 1 critical (train/inference mismatch), 1 design concern (signal overwrite), 4 minor/cosmetic.
> **Empirical verification:** All issues verified on live VPS data (541K tick rows, 7.1 days, 1-second resolution).

---

## Summary

The tick direction prediction system (training, inference, Monte Carlo visualization) has a critical train/inference feature mismatch that likely explains the near-coin-flip live accuracy. Training downsamples tick data to 5-second resolution before computing rolling features; inference reads raw 1-second data without downsampling. Both cover the same time windows but with 5x different point counts, producing systematically different feature values — especially for slope features (~5x magnitude error) and mean features (identity vs smoothed average).

---

## Files Involved

| File | Role | Issue |
|------|------|-------|
| `satellite/training/train_tick_direction.py` | Training pipeline | Downsamples to 5s (line 157), computes rolling features at 5s resolution (lines 200-204) |
| `satellite/tick_inference.py` | Daemon inference engine | Reads raw 1s rows (line 218-225), computes rolling features at 1s resolution (lines 250-276) |
| `satellite/tick_features.py` | Satellite-side tick engine | Same 1s rolling computation pattern (lines 239-276) |
| `scripts/monte_carlo_server.py` | MC visualization server | Same 1s rolling computation pattern (lines 165-188) |
| `scripts/monte_carlo.html` | MC visualization frontend | Accuracy tracker timing jitter, visual jitter |
| `src/hynous/intelligence/daemon.py` | Tick inference wiring | Overwrites v2 model signal (lines 1787-1793) |

---

## Required Reading

Read these files **completely** before implementing fixes.

### Must Read

| File | Lines | What to Understand |
|------|-------|--------------------|
| `satellite/training/train_tick_direction.py` | 113, 156-158, 178-188, 191-275 | `DOWNSAMPLE_INTERVAL = 5`. `_downsample()` keeps one row per 5s. `_compute_rolling_features()` uses window sizes `w5=1, w10=2, w30=6, w60=12` (in downsampled ticks). `_rolling_mean(x, window=1)` returns `x.copy()` (line 236-237). |
| `satellite/tick_inference.py` | 208-287 | `_get_latest_tick_features()` queries `LIMIT 60` raw 1s rows (line 218), reverses to chronological (line 231), computes rolling features using `[-5:]`, `[-10:]`, `[-30:]`, `[-60:]` array slices on raw rows. No downsample step. |
| `data-layer/src/hynous_data/engine/tick_collector.py` | 99-100 | `COMPUTE_INTERVAL = 1.0`, `WRITE_INTERVAL = 5.0`. Confirms tick_snapshots rows are at 1-second resolution. |

### Should Read

| File | Lines | What to Understand |
|------|-------|--------------------|
| `satellite/tick_features.py` | 239-276 | Alternative tick engine (daemon-side). Same 1s rolling computation pattern — same mismatch. |
| `scripts/monte_carlo_server.py` | 131-194 | `_build_features()` — same 1s rolling computation. Also: `_simulate()` (lines 196-254) for drift interpolation logic. |
| `src/hynous/intelligence/daemon.py` | 1715-1731, 1779-1799 | v2 model sets `_latest_predictions[coin]` at line 1721. Tick inference overwrites `signal`, `long_roe`, `short_roe` at lines 1787-1791. |

---

## Issue 1: Rolling Feature Resolution Mismatch (CRITICAL)

### Problem

Training downsamples to 5s before computing rolling features. Inference reads raw 1s data. The window durations match (5s/10s/30s/60s) but point counts differ by 5x, producing different feature values.

**Training** (`train_tick_direction.py`):
```
Line 113:  DOWNSAMPLE_INTERVAL = 5
Line 157:  downsampled = _downsample(rows, DOWNSAMPLE_INTERVAL)
Lines 200-204:
    w5  = max(1, 5 // 5)  = 1   (one 5s tick)
    w10 = max(1, 10 // 5) = 2   (two 5s ticks)
    w30 = max(1, 30 // 5) = 6   (six 5s ticks)
    w60 = max(1, 60 // 5) = 12  (twelve 5s ticks)
```

**Inference** (`tick_inference.py`):
```
Lines 218-225:  SELECT ... ORDER BY timestamp DESC LIMIT 60  (raw 1s rows)
Line 231:       rows = list(reversed(rows))  (no downsample)
Lines 250-276:
    book_imb[-5:]   = 5 rows   (five 1s rows)
    book_imb[-10:]  = 10 rows  (ten 1s rows)
    book_imb[-30:]  = 30 rows  (thirty 1s rows)
    arr[-60:]       = 60 rows  (sixty 1s rows)
```

### Three Sub-Problems

#### 1a. Slope features are ~5x too small at inference

The OLS slope is computed in "units per tick index" — not per second. Training: 12 ticks over 60s (each tick = 5s). Inference: 60 ticks over 60s (each tick = 1s). The slope denominator is 5x larger at inference.

Theoretical ratio: `(1/60) / (1/12) = 0.20x`

**Empirical verification** (live VPS data, 5 independent 60s windows):

| Offset | `book_imbalance_5_slope60` Train | Inference | Ratio |
|--------|----------------------------------|-----------|-------|
| 0 | +0.02881 | +0.00988 | 0.34x |
| 60 | +0.05534 | +0.00427 | 0.08x |
| 120 | +0.00134 | -0.00238 | -1.78x (sign flip) |
| 180 | +0.05428 | +0.00865 | 0.16x |
| 240 | -0.04606 | -0.00495 | 0.11x |

| Offset | `mid_price_slope60` Train | Inference | Ratio |
|--------|---------------------------|-----------|-------|
| 0 | -2.70979 | -0.42380 | 0.16x |
| 60 | +2.49301 | +0.35615 | 0.14x |
| 120 | +4.76923 | +0.96784 | 0.20x |
| 180 | +2.26049 | +0.55463 | 0.25x |
| 240 | +1.00699 | +0.05935 | 0.06x |

Ratios center around 0.20x as predicted. The model learned that a slope of +0.05 means "moderate uptrend." At inference, the same trend produces +0.01 — the model sees "flat" and underreacts.

**Affected features:** `book_imbalance_5_slope60`, `flow_imbalance_10s_slope60`, `mid_price_slope60`

#### 1b. Mean5 is a different feature at training vs inference

At training time, `w5 = 1`, so `_rolling_mean(x, window=1)` hits line 236-237:
```python
if window <= 1:
    return x.copy()
```

**Mean5 is identical to the base feature** at training time. The model learned `book_imbalance_5_mean5` and `book_imbalance_5` as redundant copies — any weight on mean5 is just extra weight on the base feature.

At inference, `np.mean(book_imb[-5:])` produces a 5-point smoothed average. The model has never seen mean5 differ from the base feature.

**Empirical verification:**

| Offset | Train (w=1, point value) | Inference (mean of 5) | Base value |
|--------|--------------------------|----------------------|------------|
| 0 | +0.949806 | +0.987631 | +0.996071 |
| 20 | +0.304157 | +0.158302 | +0.235048 |
| 40 | +0.985018 | +0.520241 | +0.508797 |
| 60 | +0.667318 | +0.865310 | +0.912186 |

Differences of 0.04 to 0.47 — the model receives a feature value it has never been trained on.

**Affected features:** `book_imbalance_5_mean5`, `flow_imbalance_10s_mean5`, `price_change_10s_mean5`, `book_imbalance_5_mean10`, `flow_imbalance_10s_mean10`

#### 1c. Std30 values differ unpredictably (0.93x–2.53x)

Training: std of 6 points at 5s intervals. Inference: std of 30 points at 1s intervals. More granular sampling captures micro-variation that coarser sampling smooths over. The ratio varies per window — sometimes higher, sometimes lower.

**Empirical verification:**

| Offset | `book_imbalance_5_std30` Train (6 pts) | Inference (30 pts) | Ratio |
|--------|----------------------------------------|--------------------|-------|
| 0 | 0.254893 | 0.339910 | 1.33x |
| 60 | 0.116815 | 0.295214 | **2.53x** |
| 120 | 0.326029 | 0.316001 | 0.97x |
| 180 | 0.357127 | 0.330637 | 0.93x |
| 240 | 0.338673 | 0.392577 | 1.16x |

**Affected features:** `book_imbalance_5_std30`, `flow_imbalance_10s_std30`, `price_change_10s_std30`

### Affected Locations

All three files compute rolling features on raw 1s data without downsampling:

| File | Function | Lines |
|------|----------|-------|
| `satellite/tick_inference.py` | `_get_latest_tick_features()` | 239-276 |
| `satellite/tick_features.py` | (rolling computation in `_compute()`) | 239-276 |
| `scripts/monte_carlo_server.py` | `_build_features()` | 155-193 |

### Fix

**Option A (recommended):** Add a downsample step in inference before computing rolling features. After reversing rows to chronological order, downsample to 5s:

```python
# In tick_inference.py:_get_latest_tick_features(), after line 231
# Downsample to match training resolution (5s)
downsampled = [rows[0]]
last_t = rows[0]["timestamp"]
for r in rows[1:]:
    if r["timestamp"] - last_t >= 4.5:
        downsampled.append(r)
        last_t = r["timestamp"]
rows = downsampled
```

Then adjust window slice sizes to match training: `[-1:]` for mean5 (window=1 → identity), `[-2:]` for mean10, `[-6:]` for std30, `[-12:]` for slope60.

Apply the same fix to `monte_carlo_server.py:_build_features()` and `tick_features.py`.

**After fixing inference, retrain the models** so the artifacts match the corrected pipeline.

**Option B:** Retrain at 1s resolution (set `DOWNSAMPLE_INTERVAL = 1` in training). This keeps inference as-is but requires ~5x more training data and compute. The rolling features would need window sizes adjusted in training to match the current inference code.

---

## Issue 2: Tick Inference Overwrites V2 Direction Model (DESIGN CONCERN)

### Problem

In `daemon.py`, the execution order within the satellite cycle is:

1. **Line 1721:** `_run_satellite_inference()` → v2 model (28 structural features, 62K snapshots) sets `_latest_predictions[coin]`:
   ```python
   self._latest_predictions[coin] = {
       "signal": result.signal,
       "long_roe": result.predicted_long_roe,
       "short_roe": result.predicted_short_roe,
       "confidence": result.confidence,
       "summary": result.summary,
       "inference_time_ms": result.inference_time_ms,
       "timestamp": _time.time(),
       "shadow": shadow,
   }
   ```

2. **Line 1770:** Condition predictions → adds `conditions`, `conditions_text`

3. **Line 1787:** Tick inference → **overwrites** `signal`, `long_roe`, `short_roe`:
   ```python
   self._latest_predictions[coin]["signal"] = tick_pred.signal
   self._latest_predictions[coin]["long_roe"] = max(0, _ret_bps * 20 / 100)
   self._latest_predictions[coin]["short_roe"] = max(0, -_ret_bps * 20 / 100)
   ```

After step 3, the dict has tick model's `signal`/`long_roe`/`short_roe` but v2 model's `confidence`/`summary`/`shadow`. This inconsistent state is consumed by:
- Briefing injection (agent sees tick signal with v2 confidence)
- ML wake system (`signal in ("long", "short")` check uses tick signal)
- Entry score computation (reads `long_roe`/`short_roe` from tick model)

### Fix Options

- **Store tick predictions under separate keys** (e.g., `tick_signal`, `tick_long_roe`, `tick_short_roe`) instead of overwriting. Consumers can then choose which signal to use.
- **Blend the two signals** with configurable weighting.
- **Gate the override:** Only overwrite if tick model confidence exceeds a threshold, or if v2 model signal is "skip".

---

## Issue 3: Feature Hash Check is a No-Op (LOW)

### Problem

`tick_inference.py` lines 171-176:
```python
expected_hash = hashlib.sha256(
    "|".join(model.feature_names).encode()
).hexdigest()[:16]
if expected_hash != model.feature_hash:
    log.warning("Feature hash mismatch for %s — skipping", name)
    continue
```

Both `model.feature_names` and `model.feature_hash` are loaded from the same `metadata.json`. The hash was computed at training time from the same feature list (`train_tick_direction.py:493`):
```python
feature_hash = hashlib.sha256("|".join(model_features).encode()).hexdigest()[:16]
metadata = {
    "feature_hash": feature_hash,
    "feature_names": model_features,
    ...
}
```

This is comparing metadata against itself — will always pass unless the JSON file is corrupted. It does **not** verify that the features built by `_get_latest_tick_features()` match what the model expects.

`monte_carlo_server.py` has no hash check at all.

### Fix

Hash the actual inference-side feature list and compare to the model's stored hash:
```python
# In tick_inference.py, at class init or first predict()
from satellite.training.train_tick_direction import MODEL_FEATURES
_code_hash = hashlib.sha256("|".join(MODEL_FEATURES).encode()).hexdigest()[:16]
# Then compare _code_hash to model.feature_hash on load
```

---

## Issue 4: Accuracy Tracker Timing Jitter (LOW)

### Problem

In `monte_carlo.html`, `evaluateAccuracy()` (line 508) checks `if (elapsed >= h)` on each 3-second WebSocket update. For a prediction at VPS time T, the first evaluation opportunity for horizon h is when `currentTime >= T + h`. Since data arrives every 3s, evaluation happens at T + h to T + h + 3.

For the 10s horizon, this is 0-30% timing error. For 60s+, it's <5%.

Directional accuracy (correct/wrong) is mostly unaffected — a few seconds rarely flips the sign. But the bps P&L numbers are noisy for short horizons because the price at T + 12s may differ from T + 10s.

### Impact

Low. The accuracy tracker is a monitoring tool, not a trading signal. The directional measurements are reliable; the bps magnitude is approximate for short horizons.

---

## Issue 5: MC Cone Visual Jitter (COSMETIC)

### Problem

`monte_carlo_server.py` line 220:
```python
rng = np.random.default_rng()
```

No seed. Every 3-second update generates 200 entirely new random paths. The cone shape fluctuates visually even when predictions haven't changed, making it appear that the model's view is changing when it's just random seed variation.

### Fix

Seed from the prediction timestamp for stable visuals between updates:
```python
rng = np.random.default_rng(int(mid_price * 1000) ^ int(time.time()))
```

Or use a fixed seed per prediction round and only re-randomize when predictions change.

---

## Issue 6: Dead Code (TRIVIAL)

`monte_carlo_server.py`:
- Line 4: `import subprocess` — unused
- Line 5: `import time` — unused
- Line 35: `_VPS_QUERY_SCRIPT = PROJECT_ROOT / "scripts" / "_mc_query.py"` — defined but never referenced (actual query is the inline `_QUERY_SCRIPT` string at line 260)

---

## Live Accuracy Results (Pre-Fix Baseline)

Collected over ~25 minutes of live prediction (n=416-486 per horizon):

| Horizon | Accuracy | n | Assessment |
|---------|----------|---|------------|
| 10s | **55.8%** | 416 | Only statistically significant result (>50% + 2 SE) |
| 15s | 51.8% | 465 | Noise |
| 20s | 48.5% | 468 | Noise |
| 30s | 51.2% | 480 | Noise |
| 45s | 48.2% | 473 | Noise |
| 60s | 47.0% | 466 | Noise / slightly harmful |
| 120s | 45.8% | 437 | Below coin flip |
| 180s | 55.6% | 486 | Suspicious — U-shape with 10s suggests artifact |

At 95% CI with n~450, the noise band around 50% is approximately ±4.6%. Only 10s exceeds this convincingly. The U-shape pattern (good at extremes, bad in the middle) is a red flag — real signal should decay monotonically with horizon length.

**Expected improvement after fixing Issue 1:** The resolution mismatch affects rolling features which account for 11 of 36 model features. Slope features (3 features, ~5x magnitude error) are the most impacted. Fixing should improve accuracy across all horizons, particularly the mid-range (30s-120s) where the model may be relying most heavily on trend features.

---

## Implementation Order

| # | Fix | Priority | Files | Dependency |
|---|-----|----------|-------|------------|
| 1 | Add downsample step in inference | **P0** | `tick_inference.py`, `monte_carlo_server.py`, `tick_features.py` | None |
| 2 | Retrain models after fix 1 | **P0** | Run `train_tick_direction.py` on VPS | Depends on fix 1 |
| 3 | Separate tick predictions from v2 in daemon | P1 | `daemon.py` | None |
| 4 | Fix feature hash check | P2 | `tick_inference.py` | None |
| 5 | Seed MC random generator | P3 | `monte_carlo_server.py` | None |
| 6 | Remove dead code | P3 | `monte_carlo_server.py` | None |

Fix 1 + retrain (fix 2) should be done together — fixing inference without retraining would make the mismatch worse (inference would match training, but the current models were trained on the old broken pipeline). After fixing and retraining, re-run the MC visualization to collect new accuracy baselines.

---

Last updated: 2026-03-30
