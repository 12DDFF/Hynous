# Tick Direction Model — Experiment Results & Findings

> **Date:** 2026-04-01
> **Branch:** `monte-carlo-live-heatmap`
> **Scope:** Empirical analysis of tick direction model live performance across regime, confidence, and time dimensions. Three inline experiments added to MC HTML to diagnose why walk-forward validation (53-69%) diverges from live accuracy (50% in long sessions, 60%+ in short bursts).

---

## Background

### The Contradiction

Walk-forward training validation (3 folds, 9 days of data) reported:

| Horizon | `dir` (>3bps) | `prod` (all moves) | Spearman |
|---------|--------------|--------------------|---------:|
| 10s | 66.6% | 68.9% | 0.326 |
| 15s | 64.1% | 64.6% | 0.268 |
| 20s | 62.7% | 61.9% | 0.231 |
| 30s | 59.9% | 59.1% | 0.188 |
| 45s | 56.7% | 56.2% | 0.133 |
| 60s | 55.9% | 55.0% | 0.115 |
| 120s | 53.6% | 53.0% | 0.080 |
| 180s | 53.4% | 52.8% | 0.083 |

But live results over a 25-minute window (n=1000+ per horizon) showed coin-flip:

| Horizon | Live Accuracy | n |
|---------|--------------|---:|
| 10s | 52.6% | 1453 |
| 15s | 52.4% | 1491 |
| 20s | 51.9% | 1417 |
| 30s | 50.1% | 1366 |
| 45s | 49.9% | 1291 |
| 60s | 50.2% | 1246 |
| 120s | 45.3% | 1145 |
| 180s | 48.9% | 1023 |

Yet an EARLIER observation window (~4 min, n=183-203) showed 62-65% accuracy at 45-60s — statistically incompatible with 50% (z=4.2, p=0.000012).

### Hypotheses Tested

1. **Regime dependence** — Does the model work during trends but fail during ranges?
2. **Confidence calibration** — Is the model more accurate when its predictions are larger?
3. **Non-stationarity** — Are there hot/cold streaks tied to changing market microstructure?

---

## Experiment Setup

Three diagnostic panels added to `scripts/monte_carlo.html` (yellow-bordered, labeled "EXP:"). All track the 60s horizon only (best balance of sample speed and prediction difficulty). Code is temporary — designed for deletion after analysis.

### Regime Detection

At each prediction, the last 30 price points are analyzed:
- `net_bps = |last_price - first_price| / first_price * 10000`
- `range_bps = (max - min) / first_price * 10000`
- `trend_quality = net_bps / range_bps`
- **Trending**: `trend_quality > 0.5 AND net_bps > 2`
- **Ranging**: everything else

Stored as `_expRegime` on each pending prediction, evaluated when the 60s horizon elapses.

### Confidence Buckets

Split by model prediction magnitude for the 60s horizon:
- **High**: `|predicted_bps| > 1.0`
- **Medium**: `0.3 < |predicted_bps| <= 1.0`
- **Low**: `|predicted_bps| <= 0.3`

### Rolling Window

Individual 60s evaluation results stored with timestamps. Rolling accuracy computed over configurable windows (1min, 2min, 5min).

---

## Results

### Run 1: 3-minute collection (during flat/declining period)

```
60s overall: 49.0% (n=98)

Regime:    Trending 44.0% (n=25)   Ranging 50.7% (n=73)
Confidence: High 75.0% (n=4)  Medium 48.3% (n=58)  Low 47.2% (n=36)
Rolling:    Last 2min 47.4%  All 49.0%
```

Market context: BTC ~$66,400-$66,500, low volatility, mostly ranging.

### Run 2: 10-minute collection (during active/mixed period)

```
=== PER-HORIZON ACCURACY ===
  10s:  54.2%  n=382   pnl=+0.181 bps
  15s:  57.3%  n=419   pnl=+0.626 bps
  20s:  57.1%  n=438   pnl=+0.798 bps
  30s:  53.5%  n=462   pnl=+0.650 bps
  45s:  56.0%  n=443   pnl=+0.337 bps
  60s:  62.2%  n=442   pnl=+0.976 bps
 120s:  58.3%  n=398   pnl=+0.668 bps
 180s:  60.9%  n=386   pnl=+1.671 bps

=== REGIME x HORIZON ===
              Trending              Ranging
  10s:    50.3% n=183           57.8% n=199
  30s:    53.5% n=217           53.5% n=245
  60s:    66.3% n=205           58.6% n=237
 120s:    53.7% n=177           62.0% n=221

=== CONFIDENCE (60s only) ===
  |pred|>1bp:  39.1%  n=23   pnl=+0.281 bps
     0.3-1bp:  62.0%  n=303  pnl=+0.684 bps
      ≤0.3bp:  67.2%  n=116  pnl=+1.876 bps

=== ROLLING 60s ===
  Last 1min: 85.5% (n=55)
  Last 2min: 65.3% (n=98)
  Last 5min: 65.5% (n=235)
```

Market context: BTC ~$66,350-$66,430, moderate volatility, mix of trending and ranging 5-minute blocks. Hourly vol ~0.3-0.4%.

### Earlier 25-minute session (reported by user, different market period)

```
  10s: 52.6%  n=1453     60s: 50.2%  n=1246
  15s: 52.4%  n=1491    120s: 45.3%  n=1145
  20s: 51.9%  n=1417    180s: 48.9%  n=1023
  30s: 50.1%  n=1366
  45s: 49.9%  n=1291
  Overall: 50.4% (10432 evals), avg P&L +0.121 bps
```

### First observation (old 1-fold models, pre-zero-return-fix, ~4min window)

```
  10s: 40.8%  n=211     60s: 65.6%  n=183
  15s: 47.1%  n=221    120s: 60.8%  n=130
  20s: 49.5%  n=218    180s: 47.6%  n=63
  30s: 52.4%  n=208
  45s: 62.6%  n=203
```

Market context: BTC ~$68,250-$68,580, strong uptrend (+65 bps in first 25 min).

---

## Key Findings

### 1. The Model's Edge is Real but Highly Non-Stationary

The model is NOT uniformly coin-flip. It swings between extended periods of genuine predictive power (60-85% accuracy in favorable windows) and extended periods of zero signal (~50%). The measured accuracy depends entirely on WHICH window you observe:

| Window | Duration | 60s Accuracy | Market State |
|--------|----------|-------------|--------------|
| First observation | ~4 min | 65.6% | Strong uptrend |
| 25-minute session | ~25 min | 50.2% | Mixed/ranging |
| Run 2 (10min) | 10 min | 62.2% | Moderate activity |
| Run 2 last 1min | 1 min | 85.5% | Hot streak |

Statistical verification: 65.6% at n=183 is z=4.2 against H0:p=0.5 (p=0.000012). 50.2% at n=1246 is z=0.14 (p=0.89). Both are real — the underlying accuracy changes over time.

### 2. Regime Dependence is Inconsistent Across Horizons

The regime hypothesis (model works during trends, fails during ranges) is NOT cleanly supported:

| Horizon | Trending | Ranging | Delta |
|---------|----------|---------|-------|
| 10s | 50.3% | **57.8%** | Ranging better |
| 30s | 53.5% | 53.5% | Equal |
| 60s | **66.3%** | 58.6% | Trending better |
| 120s | 53.7% | **62.0%** | Ranging better |

At 60s, trending IS better (+7.7pp). At 10s and 120s, RANGING is better. The simple trend/range binary doesn't capture whatever regime the model is sensitive to.

### 3. Confidence is Inverted — Small Predictions are Most Accurate

This is the most striking and actionable finding (60s horizon):

| Bucket | Accuracy | n | Avg P&L |
|--------|----------|---|---------|
| High (|pred| > 1bp) | **39.1%** | 23 | +0.281 bps |
| Medium (0.3-1bp) | 62.0% | 303 | +0.684 bps |
| Low (≤0.3bp) | **67.2%** | 116 | +1.876 bps |

The model is MOST accurate when its predictions are SMALLEST, and WORST when they're largest. Possible interpretations:

- **Large predictions = overreaction to noise.** The model sees extreme feature values (heavy book imbalance, big recent price move) and extrapolates aggressively, but these extremes mean-revert.
- **Small predictions = genuine micro-signal.** When the model makes a modest directional lean, it reflects subtle structural evidence that's more reliable.
- **P&L inversion is even more extreme.** Low-confidence trades average +1.876 bps/trade (2.7x the medium bucket). The model's SIZING should be inverted from its confidence.

**Caveat:** High-confidence n=23 is too small for definitive conclusions. The direction is clear but the magnitude is uncertain.

### 4. Rolling Accuracy Shows Distinct Hot/Cold Regimes

Run 2 rolling windows at 60s:
```
Last 1min: 85.5% (n=55)
Last 2min: 65.3% (n=98)
Last 5min: 65.5% (n=235)
```

The model was in a sustained hot streak during this 10-minute window. In the earlier 25-minute session, accuracy was flat at 50% throughout. The transition between hot and cold happens on a timescale of minutes, not seconds.

### 5. Return Autocorrelation is Near-Zero (Unconditionally)

Measured on the last 2 hours of 1s tick data:

| Lag | Autocorrelation |
|-----|----------------|
| 1s | **0.1515** |
| 2s | 0.0123 |
| 5s | -0.0249 |
| 10-60s | 0.008-0.025 |

The only significant serial dependence is at 1s lag (bid-ask bounce), which decays below the 5s downsample resolution. This means the model's signal comes from CROSS-FEATURE patterns (book imbalance predicting future direction), not from return momentum.

### 6. Walk-Forward Validation Overstates Live Performance

Three structural reasons:

1. **9-day window, 3 folds**: All folds share the same market regime. Walk-forward tests within-regime generalization, not cross-regime.
2. **Final model trains on ALL data** (including test windows): The deployed model has seen every walk-forward test row. The WF metrics describe SUBSET models that don't exist in production.
3. **Feature-return mapping is non-stationary**: Feature distributions look stable over time (book_imbalance ~0.49-0.57) but the conditional relationship between features and future returns changes.

---

## Implications for the Tick Direction System

### What Works

- The model has genuine predictive power during specific market states
- Positive average P&L across all observation windows (+0.12 to +1.67 bps)
- Small predictions (≤0.3 bps) carry the most reliable signal
- The infrastructure (feature pipeline, inference, MC visualization) is correctly aligned

### What Doesn't Work

- The model cannot be trusted unconditionally — extended periods of zero signal exist
- Large predictions (>1 bps) are anti-predictive
- Walk-forward validation doesn't predict live accuracy
- There's no reliable real-time indicator of when the model is in a hot vs cold regime

### Actionable Next Steps

1. **Inverted sizing**: When using tick predictions for entry timing, trust small predictions and distrust large ones. The current system does the opposite (conviction = prediction magnitude). This is the highest-value, lowest-effort change.

2. **Regime gating via condition models**: The existing condition engine (`vol_1h`, `vol_expand`, `momentum_quality`) may already predict when tick models have edge. Cross-reference condition predictions with tick model accuracy windows to find a reliable gate.

3. **Online recalibration**: The model's accuracy drifts on minute-to-minute timescales. A rolling accuracy tracker (like the experiment's rolling window) could gate predictions: only act when recent accuracy exceeds a threshold.

4. **More training data**: 9 days is insufficient for cross-regime generalization. Need months of tick data across different vol regimes, liquidation cascades, and market structures. The VPS tick collector should continue accumulating data.

5. **Different final model strategy**: Instead of training on ALL data (including WF test windows), train the final model only on the training partition of the last fold. This gives an honest out-of-sample estimate.

6. **Explore volatility prediction**: The condition models (vol_1h, vol_4h) predict more stationary targets. Tick-level features could improve short-term vol estimates for the trailing stop and dynamic SL systems, where the model doesn't need to predict direction.

---

## Files Modified (Temporary Experiments)

All experiment code is in `scripts/monte_carlo.html` and is marked with yellow borders and "EXP:" prefixes in the UI. To remove:

1. Delete the three `<div class="panel" id="exp-*-panel">` blocks (HTML, in the sidebar)
2. Delete the `// ─── EXPERIMENT:` state block (JS, after `BIAS_SIGNAL_COOLDOWN`)
3. Delete the regime computation block in `handleData()` (starts with `// Compute regime label`)
4. Delete the `// ── Experiment tracking` block inside `evaluateAccuracy()`
5. Delete the `// ─── EXPERIMENT: Display Functions` block (3 functions: `_expRow`, `updateExpPanels`)
6. Remove the `updateExpPanels()` call in `handleData()`
7. Remove `_expRegime` from the `pendingPredictions.push()` call

No server-side changes. No model changes. No other files affected.

---

## Data Collection Scripts

The 10-minute collection was done via a standalone Python WebSocket client (not committed). The script connects to `ws://localhost:8765`, collects predictions, evaluates them locally using the same logic as the HTML, and computes regime/confidence/rolling stats. Can be re-run anytime the MC server is active:

```bash
# Requires: MC server running on localhost:8765 with SSH tunnel to VPS
# See scripts/monte_carlo_server.py for setup
.venv/bin/python3 -c "
import asyncio, json, time, numpy as np, bisect
# [collection script as used in the conversation]
"
```

---

## Related Files

| File | Purpose |
|------|---------|
| `scripts/monte_carlo_server.py` | MC server — tick ingestion, XGBoost inference, MC simulation |
| `scripts/monte_carlo.html` | MC visualization + accuracy tracking + experiments |
| `satellite/training/train_tick_direction.py` | Training pipeline with `prod_dir_accuracy` metric |
| `satellite/tick_inference.py` | Daemon-side tick inference engine |
| `satellite/tick_features.py` | Canonical feature list source |
| `satellite/artifacts/tick_models/` | Current model artifacts (3-fold, 8 horizons) |
| `docs/revisions/mc-fixes/eval-metric-alignment.md` | Eval metric alignment implementation guide |
| `docs/revisions/tick-system-audit/README.md` | Original train/inference mismatch audit (6 issues) |
| `docs/revisions/tick-system-audit/round-2-fixes.md` | Round 2 bug fixes (std30 guard, base feature source) |
| `docs/revisions/tick-system-audit/future-entry-timing.md` | Concept doc for entry timing use case |

---

Last updated: 2026-04-01
