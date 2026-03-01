# Training

> XGBoost model training pipeline -- loads labeled snapshots from satellite.db, trains dual long/short regressors, validates via walk-forward protocol, and packages sealed model artifacts with SHAP explainability.

---

## Architecture

```
training/
├── __init__.py       # Package docstring
├── pipeline.py       # Data loading, time-based splitting, normalization
├── train.py          # XGBoost training + evaluation metrics
├── walkforward.py    # Walk-forward validation (expanding window, no data leakage)
├── artifact.py       # ModelArtifact: sealed model + scaler + metadata container
└── explain.py        # SHAP TreeExplainer integration for per-prediction interpretability
```

---

## Training Pipeline

`pipeline.py` handles data preparation in 4 steps:

### 1. Load Labeled Snapshots

`load_labeled_snapshots()` joins `snapshots` with `snapshot_labels` from satellite.db, filtering for rows where `best_long_roe_30m_net IS NOT NULL`.

### 2. Time-Based Split

`prepare_training_data()` splits by timestamp (never random). Everything before `train_end` is training data; everything at or after is validation.

- Minimum: 50 training samples, 10 validation samples
- Targets clipped to [-20%, +20%] to match labeler range

### 3. Fit Scaler on Training Data Only

A `FeatureScaler` is fitted exclusively on the training partition using the 5 transform types defined in `normalize.py`. The scaler is sealed into the model artifact and reused at inference time.

### 4. Build Feature Matrix (21 dimensions)

The final feature vector is 12 normalized structural features + 9 binary availability flags (appended without normalization):

```
[12 structural features via scaler.transform_batch()]
+
[9 availability flags as-is: liq_magnet_avail, oi_7d_avail, ...]
= 21-dimensional input
```

### TrainingData Dataclass

| Field | Type | Description |
|-------|------|-------------|
| `X_train` | `np.ndarray` | (n_train, 21) normalized features |
| `y_train` | `np.ndarray` | (n_train,) target ROE % |
| `X_val` | `np.ndarray` | (n_val, 21) normalized features |
| `y_val` | `np.ndarray` | (n_val,) target ROE % |
| `scaler` | `FeatureScaler` | Fitted on train only |
| `train_timestamps` | `np.ndarray` | Epoch timestamps for walk-forward tracking |
| `val_timestamps` | `np.ndarray` | Epoch timestamps for walk-forward tracking |
| `feature_names` | `list[str]` | 12 structural + 9 avail = 21 names |

---

## Model Training

`train.py` trains two separate XGBoost regressors:

- **model_long**: Predicts `best_long_roe_30m_net` (net ROE for long entry at 30m)
- **model_short**: Predicts `best_short_roe_30m_net` (net ROE for short entry at 30m)

### XGBoost Hyperparameters

```python
XGBOOST_PARAMS = {
    "objective": "reg:pseudohubererror",  # Robust to outlier ROE spikes
    "eval_metric": "mae",
    "huber_slope": 1.0,
    "max_depth": 4,
    "learning_rate": 0.03,
    "min_child_weight": 15,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "seed": 42,
    "nthread": -1,
}

MAX_BOOST_ROUNDS = 300
EARLY_STOPPING_ROUNDS = 10
```

`train_both_models()` trains both regressors and packages them into a `ModelArtifact` with shared scaler and combined metadata.

### Evaluation Metrics

`evaluate_model()` computes:

| Metric | Description |
|--------|-------------|
| `mae` | Mean absolute error |
| `rmse` | Root mean squared error |
| `median_ae` | Median absolute error |
| `directional_accuracy` | Fraction of predictions with correct sign |
| `precision_at_{1,2,3,5}pct` | Of predictions > X%, what % actually achieved X%? |

---

## Walk-Forward Validation

`walkforward.py:run_walk_forward()` proves the model's edge persists across different market conditions by training on expanding windows and testing on strictly future data.

### Protocol

```
Gen 0: Train days 0-60,  test days 60-74
Gen 1: Train days 0-74,  test days 74-88
Gen 2: Train days 0-88,  test days 88-102
...
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MIN_TRAIN_DAYS` | 60 | Minimum training window in days |
| `TEST_WINDOW_DAYS` | 14 | Size of each test window |
| `STEP_DAYS` | 14 | How far to advance between generations |

Each generation sees more data. Test sets never overlap (true out-of-sample). Minimum samples: 50 train, 10 test per generation.

### Profitability Check

The model is considered profitable if:
- Mean directional accuracy > 55%
- Mean validation MAE < 4.0%

### WalkForwardResult

`WalkForwardResult.aggregate()` computes across all generations:

| Stat | Description |
|------|-------------|
| `mean_mae` | Average validation MAE across all generations |
| `std_mae` | Standard deviation of validation MAE |
| `mean_directional_accuracy` | Average directional accuracy |
| `mean_precision_at_3pct` | Average precision at 3% threshold (None if insufficient data) |
| `is_profitable` | `True` if directional accuracy > 55% AND MAE < 4% |

---

## Model Artifacts

`artifact.py` provides a sealed container (`ModelArtifact`) that ensures a model and its scaler are always used together.

### Artifact Layout on Disk

```
artifacts/v{N}/
├── model_long_v{N}.pkl       # XGBoost Booster (pickle)
├── model_short_v{N}.pkl      # XGBoost Booster (pickle)
├── scaler_v{N}.json          # FeatureScaler (JSON)
└── metadata_v{N}.json        # ModelMetadata (JSON)
```

### Feature Hash Verification

At load time, `ModelArtifact.load()` checks the `feature_hash` stored in metadata against the current `FEATURE_HASH` from `features.py`. If they differ, loading is refused with a descriptive error. This prevents silently using a model trained on a different feature set.

The scaler's hash is also verified independently.

### ModelMetadata

| Field | Type | Description |
|-------|------|-------------|
| `version` | `int` | Model version number |
| `feature_hash` | `str` | SHA-256 hash of feature name list (16-char hex) |
| `feature_names` | `list[str]` | 21 feature names (12 structural + 9 avail) |
| `created_at` | `str` | ISO8601 timestamp |
| `training_samples` | `int` | Number of training rows |
| `training_start` | `str` | ISO8601 earliest training timestamp |
| `training_end` | `str` | ISO8601 latest training timestamp |
| `validation_mae` | `float` | Average of long + short validation MAE |
| `validation_samples` | `int` | Number of validation rows |
| `xgboost_params` | `dict` | Hyperparameters used |
| `notes` | `str` | Free-form notes (default: per-model MAE breakdown) |

### Direct Prediction

`ModelArtifact.predict()` provides a convenience method that handles scaler transform + avail flag append + XGBoost inference in a single call:

```python
artifact = ModelArtifact.load("artifacts/v1")
long_roe, short_roe = artifact.predict(raw_features, availability)
```

---

## SHAP Explainability

`explain.py` wraps SHAP `TreeExplainer` for per-prediction interpretability. XGBoost + TreeExplainer runs in ~100 microseconds per prediction. Requires SHAP >= 0.50.0 for XGBoost 3.x compatibility (3.x changed `base_score` to array format).

### Functions

| Function | Description |
|----------|-------------|
| `create_explainer(model)` | Create a `shap.TreeExplainer` for a trained XGBoost Booster |
| `explain_prediction(explainer, transformed_features, raw_features, feature_names, predicted_roe)` | Generate `PredictionExplanation` for a single prediction |
| `explain_batch(explainer, X)` | Compute SHAP values for a batch |
| `feature_importance_shap(explainer, X, feature_names)` | Mean absolute SHAP values for feature ranking |

### PredictionExplanation

| Field | Type | Description |
|-------|------|-------------|
| `predicted_roe` | `float` | The model's prediction |
| `base_value` | `float` | SHAP expected value (baseline) |
| `feature_names` | `list[str]` | Feature names in order |
| `feature_values` | `list[float]` | Raw feature values (for human display) |
| `shap_values` | `list[float]` | Per-feature SHAP contributions |
| `top_contributors` | `list[tuple]` | Sorted by abs(SHAP): `(name, raw_value, shap_value)` |

The `summary` property produces a human-readable string like:
```
Predicted +5.2% ROE. Top factors: oi_vs_7d_avg_ratio=1.432 (+2.10%), liq_magnet_direction=0.650 (+1.05%), ...
```

---

## Usage

### Full Training Run

```python
from satellite.store import SatelliteStore
from satellite.training.pipeline import load_labeled_snapshots, prepare_training_data
from satellite.training.train import train_both_models

store = SatelliteStore("storage/satellite.db")
store.connect()

# Load data
rows = load_labeled_snapshots(store, coin="BTC")

# Prepare (time-based split)
long_data = prepare_training_data(rows, "best_long_roe_30m_net", train_end=split_timestamp)
short_data = prepare_training_data(rows, "best_short_roe_30m_net", train_end=split_timestamp)

# Train + package
artifact = train_both_models(long_data, short_data, version=1)
artifact.save("artifacts")
```

### Walk-Forward Validation

```python
from satellite.training.walkforward import run_walk_forward

result = run_walk_forward(rows, target_column="best_long_roe_30m_net")
print(result.summary)
# Walk-forward: 5 generations, MAE=3.21+-0.45, dir_acc=57.3%, profitable=YES
```

---

## Related Documentation

- `../README.md` -- Satellite module overview (features, normalization, inference)
- `../artemis/README.md` -- Historical backfill pipeline that produces training data
- `docs/archive/` -- Revision history and implementation guides

---

Last updated: 2026-03-01
