"""XGBoost model training for entry prediction.

Two separate regressors:
  - model_long: predicts net ROE for long entry
  - model_short: predicts net ROE for short entry

Objective: reg:pseudohubererror (robust to outlier ROE spikes)
Eval metric: MAE (Mean Absolute Error)
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import xgboost as xgb

from satellite.features import AVAIL_COLUMNS, FEATURE_HASH, FEATURE_NAMES
from satellite.training.artifact import ModelArtifact, ModelMetadata
from satellite.training.pipeline import TrainingData

log = logging.getLogger(__name__)


# ─── XGBoost Configuration ──────────────────────────────────────────────────

XGBOOST_PARAMS: dict = {
    "objective": "reg:pseudohubererror",
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


# ─── Training Result ────────────────────────────────────────────────────────

@dataclass
class TrainResult:
    """Result of training a single model."""

    model: xgb.Booster
    best_iteration: int
    train_mae: float
    val_mae: float
    feature_importances: dict[str, float]


# ─── Training Function ──────────────────────────────────────────────────────

def train_model(
    data: TrainingData,
    params: dict | None = None,
) -> TrainResult:
    """Train a single XGBoost regressor.

    Args:
        data: TrainingData from prepare_training_data().
        params: Override XGBoost params (optional).

    Returns:
        TrainResult with trained model and metrics.
    """
    p = dict(XGBOOST_PARAMS)
    if params:
        p.update(params)

    dtrain = xgb.DMatrix(
        data.X_train, label=data.y_train,
        feature_names=data.feature_names,
    )
    dval = xgb.DMatrix(
        data.X_val, label=data.y_val,
        feature_names=data.feature_names,
    )

    evals_result: dict = {}
    model = xgb.train(
        p,
        dtrain,
        num_boost_round=MAX_BOOST_ROUNDS,
        evals=[(dtrain, "train"), (dval, "val")],
        early_stopping_rounds=EARLY_STOPPING_ROUNDS,
        evals_result=evals_result,
        verbose_eval=False,
    )

    best_iter = model.best_iteration
    train_mae = evals_result["train"]["mae"][best_iter]
    val_mae = evals_result["val"]["mae"][best_iter]

    # Feature importances (gain-based)
    importance_raw = model.get_score(importance_type="gain")
    total_gain = sum(importance_raw.values()) or 1
    importances = {k: v / total_gain for k, v in importance_raw.items()}

    log.info(
        "Trained model: %d rounds, train MAE=%.3f, val MAE=%.3f",
        best_iter, train_mae, val_mae,
    )

    return TrainResult(
        model=model,
        best_iteration=best_iter,
        train_mae=train_mae,
        val_mae=val_mae,
        feature_importances=importances,
    )


def train_both_models(
    long_data: TrainingData,
    short_data: TrainingData,
    version: int,
    params: dict | None = None,
) -> ModelArtifact:
    """Train both long and short models, package into a ModelArtifact.

    Args:
        long_data: Training data for long model (target = best_long_roe_30m_net).
        short_data: Training data for short model (target = best_short_roe_30m_net).
        version: Model version number.
        params: Override XGBoost params.

    Returns:
        ModelArtifact ready to save.
    """
    log.info("Training long model (v%d)...", version)
    long_result = train_model(long_data, params)

    log.info("Training short model (v%d)...", version)
    short_result = train_model(short_data, params)

    # Both models use same scaler (same features, same training data time range)
    scaler = long_data.scaler

    # feature_names includes structural features + avail columns (21 total)
    metadata = ModelMetadata(
        version=version,
        feature_hash=FEATURE_HASH,
        feature_names=long_data.feature_names,
        created_at=datetime.now(timezone.utc).isoformat(),
        training_samples=len(long_data.y_train),
        training_start=datetime.fromtimestamp(
            float(long_data.train_timestamps[0]), tz=timezone.utc,
        ).isoformat(),
        training_end=datetime.fromtimestamp(
            float(long_data.train_timestamps[-1]), tz=timezone.utc,
        ).isoformat(),
        validation_mae=(long_result.val_mae + short_result.val_mae) / 2,
        validation_samples=len(long_data.y_val),
        xgboost_params=dict(XGBOOST_PARAMS) | (params or {}),
        notes=(
            f"Long MAE: {long_result.val_mae:.3f}, "
            f"Short MAE: {short_result.val_mae:.3f}"
        ),
    )

    return ModelArtifact(
        model_long=long_result.model,
        model_short=short_result.model,
        scaler=scaler,
        metadata=metadata,
    )


# ─── Evaluation Metrics ─────────────────────────────────────────────────────

def evaluate_model(
    model: xgb.Booster,
    X: np.ndarray,
    y: np.ndarray,
    feature_names: list[str],
) -> dict:
    """Compute evaluation metrics on a dataset.

    Args:
        model: Trained XGBoost model.
        X: Feature matrix (normalized).
        y: True target values.
        feature_names: Feature names for DMatrix.

    Returns:
        Dict of metrics.
    """
    dmat = xgb.DMatrix(X, feature_names=feature_names)
    preds = model.predict(dmat)

    mae = float(np.mean(np.abs(preds - y)))
    rmse = float(np.sqrt(np.mean((preds - y) ** 2)))
    median_ae = float(np.median(np.abs(preds - y)))

    # Directional accuracy: does the model get the sign right?
    correct_sign = np.sum(np.sign(preds) == np.sign(y))
    directional_accuracy = float(correct_sign / len(y)) if len(y) > 0 else 0

    # Precision-at-threshold: "of predictions > X%, what % actually achieved X%?"
    thresholds = [1.0, 2.0, 3.0, 5.0]
    precision_at: dict = {}
    for t in thresholds:
        predicted_above = preds > t
        count = int(np.sum(predicted_above))
        if count > 0:
            actual_above = y[predicted_above] > t
            precision_at[f"precision_at_{t}pct"] = float(
                np.sum(actual_above) / count,
            )
        else:
            precision_at[f"precision_at_{t}pct"] = None

    return {
        "mae": mae,
        "rmse": rmse,
        "median_ae": median_ae,
        "directional_accuracy": directional_accuracy,
        "n_samples": len(y),
        **precision_at,
    }
