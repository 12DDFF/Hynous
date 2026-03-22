# Phase 1: Retrain Models

> **Status:** Phase 1a complete (local retrain with NULL features). Phase 1b in progress (VPS backfill + retrain).
> **Depends on:** Phase 0 fully verified (all fixes applied, all tests passing)
> **Scope:** Backfill historical features on VPS, retrain all models with complete data.

---

## Required Reading

Read these files and understand the specific sections noted before making any changes.

### Training Pipeline
- **`satellite/training/train.py`** — `train_both_models()` (lines 122-175): trains long+short XGBoost regressors, returns `ModelArtifact`. Understand the XGBoost config (lines 27-44): `reg:pseudohubererror` objective, `max_depth=4`, `learning_rate=0.03`.
- **`satellite/training/pipeline.py`** — `prepare_training_data()` (lines 86-188): loads snapshots, splits by time, fits `FeatureScaler` on train partition only. After Phase 0, this unconditionally includes all 16 AVAIL_COLUMNS.
- **`satellite/training/artifact.py`** — `ModelArtifact.save()` and `.load()`. Understand the `feature_hash` check at lines 138-146 — old artifacts with mismatched hash will fail to load (this is correct safety behavior).

### Condition Training Pipeline
- **`satellite/training/train_conditions.py`** — The main pipeline:
  - `CONDITION_TARGETS` list (lines 46-69): 14 target definitions with names and descriptions.
  - `build_condition_targets()` (lines 592-729): forward-looking target computation. Study how `target_entry_quality` is computed at lines 635-648 (current_long_roe minus mean of last 6 snapshots).
  - `train_single_condition()` (lines 741-992): walk-forward training with `EMBARGO_SNAPSHOTS=48` (line 123), `MIN_TRAIN_DAYS=60` (line 118), `TEST_DAYS=14` (line 120), `STEP_DAYS=7` (line 121).
  - `train_all_conditions()` (lines 997-1072): entry point. Loads snapshots, enriches with v3 features, builds targets, trains each.
  - XGBoost params: standard (lines 73-82, pseudohubererror), aggressive (lines 85-94, squarederror), binary (lines 97-107, logistic).
- **`satellite/training/feature_sets.py`** — Per-model feature subsets. Study `entry_quality` (lines 233-246, 12 v1-only features), `funding_4h` (lines 255-268, includes v3 `funding_rate_raw` + `funding_velocity`), `volume_1h` (lines 274-285, includes v3 `volume_acceleration` + `oi_change_rate_1h`).
- **`satellite/training/condition_artifact.py`** — `ConditionArtifact.save()` (lines 61-89), `.load()` (lines 91-138) with per-model feature hash verification. `ConditionMetadata` (lines 26-42) stores `percentiles` dict used for regime classification.

### Current Model Status
- **`satellite/conditions.py`** (lines 48-52) — `DISABLED_MODELS` set: `reversal_30m`, `momentum_quality`, `sl_survival_05`.
- **`satellite/artifacts/`** — Check what versions exist. The direction model artifact (v1) has hash `255621ae64e93145` which mismatches current `FEATURE_HASH` (`917773f7d4e31d94`) — this is why inference is disabled.

---

## Pre-Requisites

Run these checks before starting. If any fail, stop and report.

```bash
# 1. Phase 0 complete — scaler can fit all 28 features
PYTHONPATH=. python -c "
from satellite.normalize import FeatureScaler, TRANSFORM_MAP
from satellite.features import FEATURE_NAMES, NEUTRAL_VALUES
import numpy as np
assert len(TRANSFORM_MAP) == 28, f'TRANSFORM_MAP has {len(TRANSFORM_MAP)} entries, expected 28'
s = FeatureScaler()
s.fit({k: np.array([v]*20) for k, v in NEUTRAL_VALUES.items()})
assert len(s.transform(NEUTRAL_VALUES)) == 28
print('Phase 0 verified: scaler fits all 28 features')
"

# 2. Sufficient training data
PYTHONPATH=. python -c "
import sqlite3
conn = sqlite3.connect('storage/satellite.db')
conn.row_factory = sqlite3.Row
row = conn.execute('''
    SELECT COUNT(*) as cnt,
           MIN(datetime(created_at, \"unixepoch\")) as earliest,
           MAX(datetime(created_at, \"unixepoch\")) as latest
    FROM snapshots WHERE coin=\"BTC\"
''').fetchone()
print(f'BTC snapshots: {row[\"cnt\"]} rows, {row[\"earliest\"]} to {row[\"latest\"]}')
assert row['cnt'] >= 17280, f'Need >= 60 days (17280 snapshots), have {row[\"cnt\"]}'

# Check labeled snapshots (required for direction model)
labeled = conn.execute('''
    SELECT COUNT(*) as cnt FROM snapshots s
    JOIN snapshot_labels sl ON s.snapshot_id = sl.snapshot_id
    WHERE s.coin=\"BTC\" AND sl.best_long_roe_30m_net IS NOT NULL
''').fetchone()
print(f'Labeled snapshots: {labeled[\"cnt\"]}')
assert labeled['cnt'] >= 10000, f'Need >= 10000 labeled snapshots, have {labeled[\"cnt\"]}'

# Check v4 microstructure feature coverage
v4 = conn.execute('''
    SELECT COUNT(*) as cnt FROM snapshots
    WHERE coin=\"BTC\" AND body_ratio_1h IS NOT NULL
''').fetchone()
print(f'v4 microstructure snapshots: {v4[\"cnt\"]}')
conn.close()
"

# 3. Data-layer DB healthy
PYTHONPATH=. python -c "
import sqlite3
conn = sqlite3.connect('data-layer/storage/hynous-data.db')
for table in ['oi_history', 'funding_history', 'volume_history', 'liquidation_events']:
    row = conn.execute(f'SELECT COUNT(*) as cnt FROM {table}').fetchone()
    print(f'{table}: {row[0]} rows')
conn.close()
"
```

---

## Step 1.1: Retrain Main Direction Model

### Run training

The training script is `satellite/training/train.py`. It calls `train_both_models()` (line 122) which:
1. Loads labeled snapshots via `pipeline.load_labeled_snapshots()`
2. Prepares data via `pipeline.prepare_training_data()` — fits FeatureScaler on training partition
3. Trains long + short XGBoost regressors
4. Returns `ModelArtifact` with sealed scaler

```bash
# Determine next version number
ls satellite/artifacts/
# If v1 exists, next is v2

PYTHONPATH=. python -m satellite.training.train \
    --coin BTC \
    --db storage/satellite.db \
    --output satellite/artifacts/v2
```

If the training script doesn't accept CLI args directly, check its `main()` function and adjust. The key is that `prepare_training_data()` from `pipeline.py` is called with the corrected `AVAIL_COLUMNS` (Phase 0 fix 0.4).

### Verify new artifact

```bash
PYTHONPATH=. python -c "
from satellite.training.artifact import ModelArtifact
from satellite.features import FEATURE_HASH
a = ModelArtifact.load('satellite/artifacts/v2')
print(f'Artifact hash:  {a.metadata.feature_hash}')
print(f'Current hash:   {FEATURE_HASH}')
print(f'Match:          {a.metadata.feature_hash == FEATURE_HASH}')
print(f'Scaler features: {len(a.scaler.feature_names)}')
print(f'Transform map:   {len(a.scaler.transform_map)}')
assert a.metadata.feature_hash == FEATURE_HASH, 'Hash mismatch!'
assert len(a.scaler.feature_names) == 28, f'Expected 28, got {len(a.scaler.feature_names)}'
print('Direction model artifact verified')
"
```

### Verify inference engine loads

```bash
PYTHONPATH=. python -c "
from satellite.training.artifact import ModelArtifact
from satellite.inference import InferenceEngine
a = ModelArtifact.load('satellite/artifacts/v2')
engine = InferenceEngine(a, entry_threshold=3.0)
print(f'InferenceEngine loaded: threshold={engine.entry_threshold}%')
"
```

### Record quality metrics

The training script outputs walk-forward Spearman for both models. Record:
- Long model Spearman: ___
- Short model Spearman: ___
- Long model directional accuracy: ___
- Short model directional accuracy: ___

**Minimum acceptable:** Spearman >= 0.15 on holdout for both. If below, note it — proceed anyway (condition models are independent and more important for entry quality).

---

## Step 1.2: Update entry_quality Feature Set

**File:** `satellite/training/feature_sets.py`
**Location:** Lines 233-246

**Only do this if** v4 microstructure features have >= 2000 snapshots with non-null values (checked in pre-requisites above). If < 2000, skip this step and keep the v1-only feature set.

**Current** (lines 233-246):
```python
    "entry_quality": [
        "cvd_ratio_30m",
        "price_trend_1h",
        "volume_vs_1h_avg_ratio",
        "realized_vol_1h",
        "funding_vs_30d_zscore",
        "oi_vs_7d_avg_ratio",
        "oi_price_direction",
        "liq_cascade_active",
        "liq_imbalance_1h",
        "hours_to_funding",
        "liq_1h_vs_4h_avg",
        "oi_funding_pressure",
    ],
```

**Replace with:**
```python
    "entry_quality": [
        "cvd_ratio_30m",
        "price_trend_1h",
        "volume_vs_1h_avg_ratio",
        "realized_vol_1h",
        "funding_vs_30d_zscore",
        "oi_vs_7d_avg_ratio",
        "oi_price_direction",
        "liq_cascade_active",
        "liq_imbalance_1h",
        "hours_to_funding",
        "liq_1h_vs_4h_avg",
        "oi_funding_pressure",
        "body_ratio_1h",             # v4: candle conviction (high = directional candles)
        "return_autocorrelation",    # v4: trending vs mean-reverting market
        "upper_wick_ratio_1h",       # v4: selling pressure indicator
    ],
```

These 3 features directly measure entry timing quality:
- `body_ratio_1h` — High ratio = candles closing far from open = market conviction. Low = indecision.
- `return_autocorrelation` — Positive = trending (momentum entries work). Negative = mean-reverting (fade entries work).
- `upper_wick_ratio_1h` — High = rejection of highs (bearish pressure). Useful for direction-sensitive entries.

---

## Step 1.3: Retrain All Condition Models

```bash
PYTHONPATH=. python -m satellite.training.train_conditions \
    --db storage/satellite.db \
    --output satellite/artifacts/conditions \
    --coin BTC \
    --data-db data-layer/storage/hynous-data.db \
    -v
```

This retrains all 14 condition models. The script:
1. Loads snapshots from satellite.db (line 1021)
2. Enriches with v3/v4 features via `enrich_with_new_features()` from data-layer DB (line 1030)
3. Builds forward-looking targets (line 1035)
4. Trains each model via `train_single_condition()` with walk-forward validation (line 1051)

### Record results

Fill in this table from training output:

| Model | Old Spearman | New Spearman | New MAE | Features Used | Decision |
|-------|-------------|-------------|---------|---------------|----------|
| vol_1h | Strong | | | 12 v1 | |
| vol_4h | Strong | | | 12 v1 | |
| range_30m | Strong | | | 12 v1 | |
| move_30m | Strong | | | 12 v1 | |
| volume_1h | 0.66 | | | 10 (3 v3) | |
| funding_4h | 0.48 | | | 12 (2 v3) | |
| mae_long | 0.21 | | | 12 v1 | |
| mae_short | 0.22 | | | 12 v1 | |
| entry_quality | 0.26 | | | 15 (3 v4) | |
| vol_expand | 0.28 | | | 12 v1 | |
| sl_survival_03 | 0.10 | | | 10 v1 | |
| sl_survival_05 | 0.03 | | | 10 v1 | |
| reversal_30m | 0.02 | | | 10 (v3+v4) | |
| momentum_quality | 0.075 | | | 11 (v3+v4) | |

### Quality threshold decisions

**File:** `satellite/conditions.py` (lines 48-52)

Based on results:
- **Spearman >= 0.20**: Keep enabled. Remove from `DISABLED_MODELS` if currently there.
- **Spearman 0.15-0.20**: Keep enabled but note as "weak" in a comment.
- **Spearman < 0.15**: Add to `DISABLED_MODELS`. Update the comment above the set with the new Spearman value.

Apply changes to `DISABLED_MODELS` set accordingly.

---

## Step 1.4: Verify Full System

### Direction model loads at daemon startup

Start the daemon and check logs:
```bash
# Look for this line (SUCCESS):
# "Satellite inference loaded: v2 (N samples, threshold 3.0%, shadow=True)"
#
# NOT this line (FAILURE — still broken):
# "Satellite inference init failed, continuing without ML"
```

If the failure line appears, check the full traceback in the log. The most likely cause is a hash mismatch — verify the artifact was saved with the correct `FEATURE_HASH`.

### Direction predictions appear

Wait for one satellite tick (~300s after daemon start). Then:
```bash
# Check if direction predictions are cached
# (This requires a way to inspect daemon state — check dashboard ML page or daemon logs)
# Look for log lines like: "[BTC] Signal: LONG (long=+5.2%, short=-2.1%)"
```

### Condition predictions still work

Verify condition predictions are generated:
```bash
sqlite3 storage/satellite.db "
    SELECT model_name, predicted_value, percentile, regime
    FROM condition_predictions
    WHERE coin='BTC'
    ORDER BY predicted_at DESC
    LIMIT 20
"
```

Should show recent predictions for all enabled models.

### All tests pass

```bash
PYTHONPATH=. pytest satellite/tests/ -x -v
PYTHONPATH=src pytest tests/ -x -v
```

---

## Report Required

Before proceeding to Phase 2, report:
1. The complete Spearman results table (all 14 models).
2. Whether the direction model loads successfully.
3. Whether direction predictions appear in `_latest_predictions`.
4. Any model that dropped below 0.15 Spearman (disabled).
5. Any model that improved significantly (note the delta).
6. Full test suite results.

---

Last updated: 2026-03-22
