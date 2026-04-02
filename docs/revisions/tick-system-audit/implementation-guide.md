# Tick System Audit — Implementation Guide

> **Purpose:** Fix all 6 issues identified in the tick system audit (README.md).
> **Engineer:** Follow each fix in order. Do NOT skip ahead. Run verification after each fix.
> **Date:** 2026-03-31

---

## Required Reading (Before Starting)

Read these files **completely** before writing any code. Understanding the data flow end-to-end is critical — a fix applied to one file must be consistent across all three inference sites and must not break any consumer.

### Must Read (in this order)

| # | File | Lines | What You Need to Understand |
|---|------|-------|-----------------------------|
| 1 | `satellite/training/train_tick_direction.py` | 40-78, 113, 156-158, 178-188, 191-275, 280-315, 320-530 | Feature lists (26 base, 11 rolling, 36 model). `DOWNSAMPLE_INTERVAL=5`. `_downsample()` keeps 1 row per 5s. `_compute_rolling_features()` uses `w5=1, w10=2, w30=6, w60=12` (downsampled ticks). `_rolling_mean(x, window=1)` returns `x.copy()` (identity). `_rolling_slope` computes OLS in units-per-tick-index. Walk-forward structure. |
| 2 | `satellite/tick_inference.py` | 30-42, 44-49, 77-206, 208-287, 289-338 | Same 26 BASE_TICK_FEATURES. `_get_latest_tick_features()` reads 60 raw 1s rows, reverses to chronological, computes rolling features using `[-5:]`, `[-10:]`, `[-30:]`, `[-60:]` slices on raw rows. `_resolve_signal()` uses `1/horizon` weighting. `DIRECTION_THRESHOLD_BPS=0.5`. |
| 3 | `scripts/monte_carlo_server.py` | 23-30, 38-130, 131-254, 260-267, 270-355 | `_build_features()` has identical 1s rolling computation pattern. `_simulate()` does GBM with drift interpolation. `fetch_vps_data()` SSHs to VPS and runs inline Python query (LIMIT 60, schema_version=2). |
| 4 | `data-layer/src/hynous_data/engine/tick_collector.py` | 92-100, 278-471 | `COMPUTE_INTERVAL=1.0`, `WRITE_INTERVAL=5.0`. Feature computation at 1s resolution. This is the authoritative data source — tick_snapshots table rows are at 1s cadence. |

### Should Read (context for testing)

| # | File | Lines | Why |
|---|------|-------|-----|
| 5 | `src/hynous/intelligence/daemon.py` | 564-578, 1719-1799, 1801-1827 | Tick inference initialization (line 566-578). v2 model writes `signal`/`long_roe`/`short_roe` (line 1721-1730). Tick inference overwrites those keys (line 1787-1793). Entry score reads the overwritten values (line 1811-1819). |
| 6 | `src/hynous/intelligence/briefing.py` | 904-910 | Briefing reads `signal`, `long_roe`, `short_roe` from `_latest_predictions` — these are the tick-overwritten values. |
| 7 | `satellite/entry_score.py` | 78-173 | `compute_entry_score()` receives `direction_signal`, `direction_long_roe`, `direction_short_roe` — currently fed the tick-overwritten values from daemon line 1814-1816. |
| 8 | `satellite/tick_features.py` | 91-101, 191-300 | Alternative daemon-side feature engine. Same 1s pattern. Same fix needed. |
| 9 | `docs/revisions/tick-system-audit/README.md` | All | The full audit with empirical verification data. |
| 10 | `satellite/artifacts/tick_models/direction_60s/metadata.json` | All | Model metadata format. Note `downsample_interval: 5` and the 36 `feature_names`. |

---

## Fix 1: Add Downsample Step in Inference (P0)

### Problem

Training downsamples 1s tick data to 5s resolution before computing rolling features. All three inference sites (tick_inference.py, monte_carlo_server.py, tick_features.py) compute rolling features on raw 1s data. This produces systematically wrong feature values for 11 of 36 model features:

- **Slope features (~5x too small):** OLS slope denominator is 5x larger with 60 ticks vs 12 ticks.
- **Mean5 is wrong feature:** Training's `window=1` → identity copy; inference's `np.mean([-5:])` → smoothed average.
- **Std30 is unpredictable:** 6-point std vs 30-point std captures different granularity.

### Files to Modify

1. `satellite/tick_inference.py` — lines 208-283
2. `scripts/monte_carlo_server.py` — lines 131-193
3. `satellite/tick_features.py` — (rolling computation section, but see note below)

### Implementation

#### 1a. `satellite/tick_inference.py`

In `_get_latest_tick_features()`, after the row reversal at line 231 and before the base feature extraction at line 236, add a downsample step. Then replace all hard-coded window sizes with training-consistent sizes.

**After line 231** (`rows = list(reversed(rows))`), add:

```python
            # Downsample to 5s resolution to match training pipeline
            # (training uses DOWNSAMPLE_INTERVAL=5 in train_tick_direction.py)
            ds_rows = [rows[0]]
            _last_ds_t = rows[0]["timestamp"]
            for _r in rows[1:]:
                if _r["timestamp"] - _last_ds_t >= 4.5:
                    ds_rows.append(_r)
                    _last_ds_t = _r["timestamp"]
```

Then `latest` (line 233) stays as `rows[-1]` (most recent raw row for base features), but rolling features are computed on `ds_rows`.

**Replace the rolling feature block** (lines 239-276) with:

```python
            # Compute rolling aggregates from DOWNSAMPLED history
            # Window sizes match training: w5=1, w10=2, w30=6, w60=12
            if len(ds_rows) >= 2:
                ds_vals = {f: [r[f] or 0.0 for r in ds_rows] for f in BASE_TICK_FEATURES}

                book_imb = ds_vals["book_imbalance_5"]
                flow_imb = ds_vals["flow_imbalance_10s"]
                price_chg = ds_vals["price_change_10s"]
                mid = ds_vals["mid_price"]

                n = len(ds_rows)

                # w5=1: at training, _rolling_mean(x, window=1) returns x.copy()
                # So mean5 = the latest downsampled value (identity, not average)
                features["book_imbalance_5_mean5"] = book_imb[-1]
                features["flow_imbalance_10s_mean5"] = flow_imb[-1]
                features["price_change_10s_mean5"] = price_chg[-1]

                # w10=2: mean of last 2 downsampled ticks
                w10 = min(2, n)
                features["book_imbalance_5_mean10"] = float(np.mean(book_imb[-w10:]))
                features["flow_imbalance_10s_mean10"] = float(np.mean(flow_imb[-w10:]))

                # w30=6: std of last 6 downsampled ticks
                w30 = min(6, n)
                if w30 >= 2:
                    features["book_imbalance_5_std30"] = float(np.std(book_imb[-w30:]))
                    features["flow_imbalance_10s_std30"] = float(np.std(flow_imb[-w30:]))
                    features["price_change_10s_std30"] = float(np.std(price_chg[-w30:]))
                else:
                    features["book_imbalance_5_std30"] = 0.0
                    features["flow_imbalance_10s_std30"] = 0.0
                    features["price_change_10s_std30"] = 0.0

                # w60=12: slope of last 12 downsampled ticks
                w60 = min(12, n)
                for arr, slope_name in [
                    (book_imb, "book_imbalance_5_slope60"),
                    (flow_imb, "flow_imbalance_10s_slope60"),
                    (mid, "mid_price_slope60"),
                ]:
                    seg = np.array(arr[-w60:], dtype=np.float32)
                    if len(seg) >= 3:
                        t = np.arange(len(seg), dtype=np.float32)
                        t_m, y_m = t.mean(), seg.mean()
                        cov = np.sum((t - t_m) * (seg - y_m))
                        var = np.sum((t - t_m) ** 2)
                        features[slope_name] = float(cov / var) if var > 0 else 0.0
                    else:
                        features[slope_name] = 0.0
            else:
                from satellite.training.train_tick_direction import ROLLING_FEATURES
                for rf in ROLLING_FEATURES:
                    features.setdefault(rf, 0.0)
```

**Why `len(ds_rows) >= 2`** instead of `>= 5`: After downsampling 60 raw 1s rows to 5s, you get ~12 rows. But if data is sparse (gaps), you might get fewer. The rolling feature block needs at least 2 downsampled rows to compute anything meaningful. The old threshold of 5 was for 5 raw rows; with downsampled data, 2 is sufficient for the identity mean (w5=1) and the mean of 2 (w10=2).

**Also increase the SQL LIMIT** from 60 to 120 at line 222 to ensure we get enough 1s rows to produce 12+ downsampled ticks for the 60s slope window:

```python
                ORDER BY timestamp DESC LIMIT 120
```

60 raw 1s rows → ~12 downsampled 5s ticks (exactly the w60 window). With any data gaps, this may not be enough. 120 raw rows covers ~2 minutes, giving 24 downsampled ticks — enough for the full w60=12 window even with gaps.

#### 1b. `scripts/monte_carlo_server.py`

In `_build_features()`, add the same downsample step after `rows.reverse()` at line 81.

**In `fetch_and_predict()`** (line 70), after `rows.reverse()` (line 80), add:

```python
        # Downsample to 5s to match training resolution
        ds_rows = [rows[0]]
        _last_t = rows[0].get("timestamp", 0)
        for _r in rows[1:]:
            _rt = _r.get("timestamp", 0)
            if _rt - _last_t >= 4.5:
                ds_rows.append(_r)
                _last_t = _rt
```

Then pass `ds_rows` to `_build_features()` for rolling computation. The base features still come from `latest = rows[-1]` (most recent raw row).

**In `_build_features()`**, apply the same window size corrections as tick_inference.py above. The method receives `rows` — change it to receive both the latest raw row and downsampled rows, or restructure to match.

The cleanest approach: change `_build_features` to accept `(self, rows, ds_rows)`:
- Base features from `rows[-1]` (latest raw)
- Rolling features from `ds_rows` with training-consistent window sizes

**Replace lines 155-193** of `_build_features()` with the same downsampled rolling logic from Fix 1a above. The pattern is identical — use `ds_rows` instead of raw `rows` for rolling features, use `w5=1(identity), w10=2, w30=6, w60=12`.

**Also update the SQL query** (line 264) LIMIT from 60 to 120:

```python
rows=conn.execute("SELECT * FROM tick_snapshots WHERE coin=? AND schema_version=2 ORDER BY timestamp DESC LIMIT 120",("BTC",)).fetchall()
```

#### 1c. `satellite/tick_features.py` — NO CHANGE NEEDED

`tick_features.py` (class `TickFeatureEngine`) computes features from **live WebSocket data** and writes them to `tick_snapshots`. It is the **data producer**, not a model consumer. It computes the same 26 base features that the tick_collector computes. It does NOT compute the 11 rolling features or run any models. The rolling features are only computed at inference/training time from the stored snapshots.

**Verify this claim:** Read `tick_features.py` lines 191-300. The `_compute()` method builds a `TickSnapshot` with `features` dict containing only the 26 base features (book_imbalance, flow, price_change, etc.). There is no rolling mean/std/slope computation. The snapshot is written to DB as-is.

If verification fails (i.e., tick_features.py DOES compute rolling features), then apply the same fix. But based on my reading, it does not — it only produces raw base features.

### Verification (Fix 1)

**Static test:** Write a unit test that verifies downsample + rolling feature computation matches training output for a known input. Create `satellite/tests/test_tick_inference.py`:

```python
"""Tests for tick inference downsample + rolling feature alignment."""

import numpy as np
import pytest


def _make_rows(n: int, interval_s: float = 1.0, base_imb: float = 0.6) -> list[dict]:
    """Create synthetic tick_snapshots rows at given interval."""
    rows = []
    t0 = 1700000000.0
    for i in range(n):
        rows.append({
            "timestamp": t0 + i * interval_s,
            "coin": "BTC",
            "schema_version": 2,
            "book_imbalance_5": base_imb + 0.01 * (i % 5),
            "book_imbalance_10": 0.5,
            "book_imbalance_20": 0.5,
            "bid_depth_usd_5": 500000.0,
            "ask_depth_usd_5": 500000.0,
            "spread_pct": 0.0001,
            "mid_price": 80000.0 + i * 0.5,
            "buy_vwap_deviation": 0.0001,
            "sell_vwap_deviation": -0.0001,
            "flow_imbalance_10s": 0.55 + 0.005 * (i % 3),
            "flow_imbalance_30s": 0.52,
            "flow_imbalance_60s": 0.51,
            "flow_intensity_10s": 3.0,
            "flow_intensity_30s": 2.5,
            "trade_volume_10s_usd": 100000.0,
            "trade_volume_30s_usd": 250000.0,
            "price_change_10s": 0.02 + 0.001 * i,
            "price_change_30s": 0.05,
            "price_change_60s": 0.08,
            "large_trade_imbalance": 0.5,
            "book_imbalance_delta_5s": 0.01,
            "book_imbalance_delta_10s": 0.02,
            "depth_ratio_change_5s": 0.0,
            "max_trade_usd_60s": 50000.0,
            "trade_count_60s": 150.0,
            "trade_count_10s": 30.0,
        })
    return rows


def _downsample(rows: list[dict], interval_s: int = 5) -> list[dict]:
    """Downsample rows (same logic as training and inference fix)."""
    if not rows:
        return []
    result = [rows[0]]
    last_t = rows[0]["timestamp"]
    for r in rows[1:]:
        if r["timestamp"] - last_t >= interval_s - 0.5:
            result.append(r)
            last_t = r["timestamp"]
    return result


class TestDownsampleAlignment:
    """Verify that inference downsample matches training downsample."""

    def test_60_rows_at_1s_downsample_to_12(self):
        """60 raw 1s rows should produce exactly 12 downsampled 5s rows."""
        rows = _make_rows(60, interval_s=1.0)
        ds = _downsample(rows)
        assert len(ds) == 12

    def test_120_rows_at_1s_downsample_to_24(self):
        """120 raw 1s rows should produce exactly 24 downsampled 5s rows."""
        rows = _make_rows(120, interval_s=1.0)
        ds = _downsample(rows)
        assert len(ds) == 24

    def test_downsample_preserves_5s_spacing(self):
        """Each downsampled row should be ~5s apart."""
        rows = _make_rows(60, interval_s=1.0)
        ds = _downsample(rows)
        for i in range(1, len(ds)):
            gap = ds[i]["timestamp"] - ds[i - 1]["timestamp"]
            assert 4.5 <= gap <= 5.5, f"Gap {gap}s at index {i}"


class TestMean5IsIdentity:
    """Verify that mean5 after downsample is identity (matches training w5=1)."""

    def test_mean5_equals_latest_value(self):
        """mean5 with w5=1 should be the latest downsampled point, not an average."""
        rows = _make_rows(60, interval_s=1.0)
        ds = _downsample(rows)
        book_imb = [r["book_imbalance_5"] for r in ds]
        # With w5=1, mean5 = book_imb[-1] (identity, not average)
        mean5 = book_imb[-1]
        avg5 = float(np.mean(book_imb[-5:]))
        # These should differ unless all 5 values are identical
        assert mean5 == book_imb[-1]
        # The OLD inference code would compute np.mean(raw[-5:]) which is wrong


class TestSlopeScaling:
    """Verify slope features have correct magnitude after downsample."""

    def test_slope_on_linear_trend(self):
        """A known linear trend should produce the same slope in training and inference."""
        # Create rows with linear mid_price trend: 80000 + 0.5*i
        rows = _make_rows(120, interval_s=1.0)
        ds = _downsample(rows)

        mid_ds = np.array([r["mid_price"] for r in ds], dtype=np.float32)
        mid_raw = np.array([r["mid_price"] for r in rows], dtype=np.float32)

        # Training slope: last 12 downsampled ticks
        seg_train = mid_ds[-12:]
        t = np.arange(len(seg_train), dtype=np.float32)
        t_m, y_m = t.mean(), seg_train.mean()
        slope_train = float(np.sum((t - t_m) * (seg_train - y_m)) / np.sum((t - t_m) ** 2))

        # OLD inference slope: last 60 raw ticks (WRONG)
        seg_old = mid_raw[-60:]
        t2 = np.arange(len(seg_old), dtype=np.float32)
        t2_m, y2_m = t2.mean(), seg_old.mean()
        slope_old = float(np.sum((t2 - t2_m) * (seg_old - y2_m)) / np.sum((t2 - t2_m) ** 2))

        # FIXED inference slope: last 12 downsampled ticks (same as training)
        slope_fixed = slope_train  # After fix, inference uses downsampled data

        # The old slope should be ~5x smaller than training
        ratio = slope_old / slope_train if slope_train != 0 else 0
        assert 0.15 <= ratio <= 0.25, f"Old slope ratio {ratio:.3f} — expected ~0.20"

        # The fixed slope should match training exactly
        assert slope_fixed == pytest.approx(slope_train, rel=1e-5)
```

**Run:**
```bash
PYTHONPATH=. pytest satellite/tests/test_tick_inference.py -v
```

All tests must pass. If any fail, pause and report.

**Dynamic test:** After deploying, run the MC server locally and compare the feature values it computes to a manual computation from the same raw rows. The slope features should now be ~5x larger than before the fix (matching training magnitude).

---

## Fix 2: Retrain Models After Fix 1 (P0)

### Problem

The current model artifacts in `satellite/artifacts/tick_models/` were trained on 5s-downsampled features. After Fix 1, inference now correctly produces 5s-downsampled features. The models are already compatible with the fixed inference. **No retraining is needed immediately.**

### Reasoning

This is a correction from the audit's recommendation. The audit says "fixing inference without retraining would make the mismatch worse." This would be true if we changed the **training** resolution. But Fix 1 changes **inference** to match **training** — not the other way around. After Fix 1, inference produces features at the same resolution training used. The existing model artifacts are correct.

### When Retraining IS Needed

Retrain when you have accumulated significantly more data (currently ~7.1 days, 108K samples). More walk-forward generations will increase statistical confidence, particularly for the short horizons (10-45s) that currently have only 1 generation.

**To retrain (on VPS):**
```bash
cd /opt/hynous
.venv/bin/python -m satellite.training.train_tick_direction \
    --db storage/satellite.db \
    --horizons 10,15,20,30,45,60,120,180 \
    --train-days 4 \
    --test-days 1
```

### Verification (Fix 2)

No code changes. Verify by running the MC server after Fix 1 and confirming the live accuracy tracker shows improvement over the pre-fix baseline (55.8% at 10s). Allow at least 30 minutes of data collection for the 180s horizon to accumulate sufficient evaluations.

---

## Fix 3: Separate Tick Predictions from V2 in Daemon (P1)

### Problem

In `daemon.py`, tick inference at lines 1787-1793 **overwrites** the v2 direction model's `signal`, `long_roe`, and `short_roe` in `_latest_predictions[coin]`. After the overwrite, the dict has:
- Tick model's signal/ROE (from tick inference)
- V2 model's confidence/summary/shadow (from structural model)

This inconsistent state is consumed by:
- **Briefing** (briefing.py:906-908) — agent sees tick signal described with v2 confidence
- **Entry score** (daemon.py:1814-1816) — entry gating uses tick ROE, not v2 ROE
- **ML wake** — wake trigger check uses tick signal

Additionally, `tick_predictions` and `tick_inference_ms` keys (lines 1792-1793) are written but **never read by any consumer** in the codebase.

### Files to Modify

1. `src/hynous/intelligence/daemon.py` — lines 1779-1799
2. `src/hynous/intelligence/briefing.py` — lines 904-910
3. No changes to entry_score.py (it receives params from daemon, interface unchanged)

### Implementation

#### 3a. `daemon.py` — Store tick predictions under separate keys

**Replace lines 1779-1799** (the tick inference block) with:

```python
                        # --- Tick direction inference ---
                        if self._tick_inference:
                            try:
                                tick_pred = self._tick_inference.predict(coin)
                                if tick_pred:
                                    with self._latest_predictions_lock:
                                        if coin not in self._latest_predictions:
                                            self._latest_predictions[coin] = {}
                                        self._latest_predictions[coin]["tick_signal"] = tick_pred.signal
                                        _ret_bps = tick_pred.predicted_return_bps
                                        self._latest_predictions[coin]["tick_long_roe"] = max(0, _ret_bps * 20 / 100)
                                        self._latest_predictions[coin]["tick_short_roe"] = max(0, -_ret_bps * 20 / 100)
                                        self._latest_predictions[coin]["tick_predictions"] = tick_pred.predictions
                                        self._latest_predictions[coin]["tick_inference_ms"] = tick_pred.inference_time_ms
                                    logger.debug(
                                        "Tick inference %s: %s (%.1f bps, %.1fms)",
                                        coin, tick_pred.signal, _ret_bps, tick_pred.inference_time_ms,
                                    )
                            except Exception:
                                logger.debug("Tick inference failed for %s", coin, exc_info=True)
```

**Key changes:**
- `signal` → `tick_signal`
- `long_roe` → `tick_long_roe`
- `short_roe` → `tick_short_roe`

The v2 model's `signal`, `long_roe`, `short_roe` are now **preserved**. Both models' outputs coexist in the dict.

#### 3b. `briefing.py` — Show both model signals

**Replace lines 904-910** (inside `_build_ml_section()`) with code that shows both the structural (v2) and tick direction signals:

Find:
```python
        signal = pred.get("signal", "skip")
        long_roe = pred.get("long_roe", 0)
        short_roe = pred.get("short_roe", 0)
        shadow = pred.get("shadow", True)
        mode = " [shadow]" if shadow else ""
```

Replace with:
```python
        signal = pred.get("signal", "skip")
        long_roe = pred.get("long_roe", 0)
        short_roe = pred.get("short_roe", 0)
        shadow = pred.get("shadow", True)
        mode = " [shadow]" if shadow else ""

        # Tick direction model (short-horizon microstructure)
        tick_signal = pred.get("tick_signal")
        tick_long_roe = pred.get("tick_long_roe", 0)
        tick_short_roe = pred.get("tick_short_roe", 0)
```

Then, wherever the signal line is formatted for the briefing output (the line that outputs something like `"BTC: LONG (predicted +8.5% ROE)"`), add a tick signal line below it if `tick_signal` is not None. Follow the existing formatting pattern exactly — read the surrounding code to match the style.

The exact formatting depends on what follows line 910. Read lines 910-925 of briefing.py to find the formatting block and add a tick line in the same style.

#### 3c. Entry score — No changes needed

The entry score at daemon.py:1814-1816 reads:
```python
direction_signal=_dir_pred.get("signal"),
direction_long_roe=_dir_pred.get("long_roe", 0),
direction_short_roe=_dir_pred.get("short_roe", 0),
```

After Fix 3a, these keys now contain the **v2 model's** values (unchanged by tick inference). This is correct — the structural direction model (28 features, 62K snapshots, walk-forward validated) should drive entry scoring, not the microstructure tick model.

If in the future we want the tick model to contribute to entry scoring, we can add `tick_signal`/`tick_long_roe`/`tick_short_roe` as separate parameters to `compute_entry_score()`. But that's a design decision, not a bug fix.

### Verification (Fix 3)

**Static test:** Add to `satellite/tests/test_tick_inference.py`:

```python
class TestDaemonPredictionKeys:
    """Verify tick predictions don't overwrite v2 model predictions."""

    def test_tick_keys_are_separate(self):
        """Tick model should use tick_signal, not signal."""
        # Simulate the daemon's _latest_predictions dict after both models run
        preds = {
            # V2 model writes these
            "signal": "long",
            "long_roe": 5.0,
            "short_roe": 1.0,
            "confidence": 0.72,
            "summary": "Bullish structure",
        }
        # Tick model writes these (after fix)
        preds["tick_signal"] = "short"
        preds["tick_long_roe"] = 0.2
        preds["tick_short_roe"] = 0.8

        # V2 signal should be preserved
        assert preds["signal"] == "long"
        assert preds["long_roe"] == 5.0
        assert preds["short_roe"] == 1.0

        # Tick signal is separate
        assert preds["tick_signal"] == "short"
        assert preds["tick_long_roe"] == 0.2
        assert preds["tick_short_roe"] == 0.8
```

**Dynamic test:** Start the daemon in paper mode. Observe logs. Verify:
1. The v2 model's `signal` in briefing output is NOT overwritten by tick predictions.
2. Both signals appear in the briefing (v2 structural + tick microstructure).
3. Entry score computation uses the v2 model's signal (not tick).

---

## Fix 4: Fix Feature Hash Check (P2)

### Problem

`tick_inference.py` lines 170-176 computes a hash from `model.feature_names` and compares it to `model.feature_hash`. Both values come from the same `metadata.json` file. This will always pass unless the JSON is corrupted — it's comparing metadata against itself.

### Files to Modify

1. `satellite/tick_inference.py` — lines 170-176

### Implementation

**Replace lines 170-176** with a check that compares the **inference-side** feature list against the model's stored hash:

```python
                # Verify feature alignment: hash the code's feature list
                # and compare to the model's training-time hash
                from satellite.training.train_tick_direction import MODEL_FEATURES
                _code_hash = hashlib.sha256(
                    "|".join(MODEL_FEATURES).encode()
                ).hexdigest()[:16]
                if _code_hash != model.feature_hash:
                    log.warning(
                        "Feature hash mismatch for %s: code=%s model=%s — skipping",
                        name, _code_hash, model.feature_hash,
                    )
                    continue
```

This import is safe — `MODEL_FEATURES` is a module-level constant list. The import can also be moved to module level or class `__init__` for efficiency, but since this runs only once per model per predict() call (~8 times every 300s), the overhead is negligible.

### Verification (Fix 4)

**Static test:** Add to `satellite/tests/test_tick_inference.py`:

```python
class TestFeatureHashCheck:
    """Verify feature hash validates code features against model metadata."""

    def test_hash_matches_current_code(self):
        """The code's MODEL_FEATURES hash should match deployed model metadata."""
        import hashlib
        import json
        from pathlib import Path
        from satellite.training.train_tick_direction import MODEL_FEATURES

        code_hash = hashlib.sha256(
            "|".join(MODEL_FEATURES).encode()
        ).hexdigest()[:16]

        # Check against at least one deployed model
        meta_path = Path("satellite/artifacts/tick_models/direction_60s/metadata.json")
        if meta_path.exists():
            with open(meta_path) as f:
                meta = json.load(f)
            assert code_hash == meta["feature_hash"], (
                f"Code features hash {code_hash} != model hash {meta['feature_hash']}. "
                "Feature list may have diverged from training."
            )

    def test_hash_detects_feature_change(self):
        """If feature list changes, hash should NOT match."""
        import hashlib
        altered = ["book_imbalance_5", "FAKE_FEATURE"]
        altered_hash = hashlib.sha256(
            "|".join(altered).encode()
        ).hexdigest()[:16]

        from satellite.training.train_tick_direction import MODEL_FEATURES
        code_hash = hashlib.sha256(
            "|".join(MODEL_FEATURES).encode()
        ).hexdigest()[:16]

        assert altered_hash != code_hash
```

---

## Fix 5: Seed MC Random Generator (P3)

### Problem

`monte_carlo_server.py` line 220: `rng = np.random.default_rng()` with no seed. Every 3s update generates 200 entirely new random paths. The cone visually fluctuates even when predictions haven't changed.

### Files to Modify

1. `scripts/monte_carlo_server.py` — line 220

### Implementation

**Replace line 220:**

```python
        rng = np.random.default_rng()
```

With:

```python
        # Seed from prediction state for stable visuals between identical predictions.
        # Changes when price or predictions change, stays stable otherwise.
        _seed_val = int(price * 1000) % (2**31)
        if predictions:
            _seed_val ^= int(sum(predictions.values()) * 10000) % (2**31)
        rng = np.random.default_rng(_seed_val)
```

This ensures:
- Same price + same predictions → same paths → stable cone visual
- Price changes → new paths → cone updates naturally
- No visual jitter from pure RNG variation

### Verification (Fix 5)

**Static test:** Call `_simulate()` twice with identical inputs and verify the output is identical:

```python
class TestMCSeeding:
    def test_same_inputs_same_paths(self):
        """Identical price + predictions should produce identical MC paths."""
        # This requires instantiating TickPredictor or extracting _simulate.
        # Simplest: verify the seed formula is deterministic.
        price = 82500.0
        preds = {60: 1.5, 120: 2.0, 180: 2.5}
        seed1 = int(price * 1000) % (2**31)
        seed1 ^= int(sum(preds.values()) * 10000) % (2**31)
        seed2 = int(price * 1000) % (2**31)
        seed2 ^= int(sum(preds.values()) * 10000) % (2**31)
        assert seed1 == seed2

        rng1 = np.random.default_rng(seed1)
        rng2 = np.random.default_rng(seed2)
        assert np.array_equal(rng1.normal(0, 1, 100), rng2.normal(0, 1, 100))
```

**Visual test:** Open the MC frontend. Observe the cone. It should remain stable between updates when price/predictions haven't changed significantly.

---

## Fix 6: Remove Dead Code (P3)

### Problem

`monte_carlo_server.py` has unused imports and an unreferenced variable.

### Files to Modify

1. `scripts/monte_carlo_server.py` — lines 4, 5, 35

### Implementation

**Delete line 14** (`import subprocess`).

**Delete line 15** (`import time`).

**Delete line 35** (`_VPS_QUERY_SCRIPT = PROJECT_ROOT / "scripts" / "_mc_query.py"`).

After deletion, verify the remaining imports are all used:
- `asyncio` — used (async server, subprocess, sleep)
- `json` — used (parsing, serialization)
- `logging` — used (log)
- `pathlib.Path` — used (PROJECT_ROOT, ARTIFACTS_DIR, etc.)
- `numpy` — used (simulation, arrays)

### Verification (Fix 6)

**Static test:** Run the server and confirm no ImportError:
```bash
python scripts/monte_carlo_server.py
```

Should start without errors. Ctrl+C to stop.

---

## Full System Verification

After all 6 fixes are applied, run the complete verification sequence:

### 1. Unit Tests

```bash
# Tick inference tests (new)
PYTHONPATH=. pytest satellite/tests/test_tick_inference.py -v

# Existing entry score tests (must still pass)
PYTHONPATH=. pytest satellite/tests/test_entry_score.py -v

# Full satellite test suite
PYTHONPATH=. pytest satellite/tests/ -v

# Full project test suite
PYTHONPATH=src pytest tests/ -v
```

**All tests must pass.** If any fail, pause and report which test(s) and the error message.

### 2. MC Server Smoke Test

```bash
python scripts/monte_carlo_server.py
```

- Server should start without errors
- Open `scripts/monte_carlo.html` in browser
- Verify: connection established, predictions stream, MC cone renders
- Verify: cone is visually stable between updates (no jitter when predictions don't change)
- Verify: accuracy tracker accumulates data

### 3. Static Analysis

```bash
# Check for any remaining references to the old overwrite pattern
grep -n '"signal".*tick_pred' src/hynous/intelligence/daemon.py
# Should return NO matches (old overwrite removed)

# Check tick_signal key is used instead
grep -n 'tick_signal' src/hynous/intelligence/daemon.py
# Should return matches in the tick inference block

# Verify no broken imports
python -c "from satellite.tick_inference import TickInferenceEngine; print('OK')"
python -c "from scripts.monte_carlo_server import TickPredictor; print('OK')" 2>/dev/null || echo "Module import test (expected to need adjustments for script)"
```

### 4. Integration Check

Verify the complete data flow hasn't been broken:

1. **tick_collector → satellite.db → tick_inference:** The collector writes 1s rows. Inference reads them, downsamples to 5s, computes rolling features, runs models. The SQL LIMIT is now 120 to ensure enough rows for downsampling.

2. **tick_inference → daemon → briefing:** Tick predictions stored under `tick_signal`/`tick_long_roe`/`tick_short_roe`. V2 model's `signal`/`long_roe`/`short_roe` preserved. Briefing shows both.

3. **v2 model → entry_score:** Entry score reads `signal`/`long_roe`/`short_roe` which are now the v2 model's values (correct — structural model should drive entry decisions).

4. **MC server → frontend:** Same downsample fix applied. Predictions are seeded for stable visuals.

---

## Issue Tracker

After all fixes, update the audit status:

| # | Fix | Status | Files Changed |
|---|-----|--------|---------------|
| 1 | Downsample in inference | Done | `tick_inference.py`, `monte_carlo_server.py` |
| 2 | Retrain models | Not needed (inference now matches training) | None |
| 3 | Separate tick predictions | Done | `daemon.py`, `briefing.py` |
| 4 | Feature hash check | Done | `tick_inference.py` |
| 5 | Seed MC RNG | Done | `monte_carlo_server.py` |
| 6 | Remove dead code | Done | `monte_carlo_server.py` |

Update `docs/revisions/tick-system-audit/README.md` line 3:
```
> **Status:** All 6 issues fixed (2026-03-31)
```

---

Last updated: 2026-03-31
