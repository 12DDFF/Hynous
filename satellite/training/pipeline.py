"""Training data pipeline: load from satellite.db, split, normalize, export.

This pipeline:
  1. Loads labeled snapshots from satellite.db
  2. Splits by time (walk-forward, never random)
  3. Fits scaler on training partition only
  4. Exports normalized feature matrices ready for XGBoost
"""

import logging
from dataclasses import dataclass

import numpy as np

from satellite.features import AVAIL_COLUMNS, FEATURE_NAMES, NEUTRAL_VALUES
from satellite.normalize import FeatureScaler

log = logging.getLogger(__name__)


@dataclass
class TrainingData:
    """Prepared training data for one model (long or short)."""

    X_train: np.ndarray         # (n_train, n_features) — normalized
    y_train: np.ndarray         # (n_train,) — target ROE
    X_val: np.ndarray           # (n_val, n_features) — normalized
    y_val: np.ndarray           # (n_val,) — target ROE
    scaler: FeatureScaler       # fitted on train only
    train_timestamps: np.ndarray
    val_timestamps: np.ndarray
    feature_names: list[str]


def load_labeled_snapshots(
    store: object,
    coin: str,
    start: float | None = None,
    end: float | None = None,
) -> list[dict]:
    """Load snapshots with labels joined from satellite.db.

    Args:
        store: SatelliteStore instance.
        coin: Coin to load.
        start: Start time (epoch).
        end: End time (epoch).

    Returns:
        List of dicts with features + labels.
    """
    query = """
        SELECT s.*, sl.best_long_roe_30m_net, sl.best_short_roe_30m_net,
               sl.best_long_roe_30m_gross, sl.best_short_roe_30m_gross,
               sl.worst_long_mae_30m, sl.worst_short_mae_30m
        FROM snapshots s
        JOIN snapshot_labels sl ON s.snapshot_id = sl.snapshot_id
        WHERE s.coin = ?
          AND sl.best_long_roe_30m_net IS NOT NULL
    """
    params = [coin]

    if start is not None:
        query += " AND s.created_at >= ?"
        params.append(start)
    if end is not None:
        query += " AND s.created_at <= ?"
        params.append(end)

    query += " ORDER BY s.created_at ASC"

    rows = store.conn.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def prepare_training_data(
    rows: list[dict],
    target_column: str,
    train_end: float,
) -> TrainingData:
    """Split and normalize data for training.

    Uses time-based split (not random). Fits scaler on train partition ONLY.

    Args:
        rows: List of dicts from load_labeled_snapshots().
        target_column: Label column name (e.g., "best_long_roe_30m_net").
        train_end: Timestamp dividing train/val. Everything before = train.

    Returns:
        TrainingData with normalized features and targets.
    """
    # Split by time
    train_rows = [r for r in rows if r["created_at"] < train_end]
    val_rows = [r for r in rows if r["created_at"] >= train_end]

    if len(train_rows) < 50:
        raise ValueError(
            f"Too few training samples: {len(train_rows)} (minimum 50)",
        )
    if len(val_rows) < 10:
        raise ValueError(
            f"Too few validation samples: {len(val_rows)} (minimum 10)",
        )

    # Extract raw features as arrays
    def extract_features(row_list: list[dict]) -> dict[str, np.ndarray]:
        result = {}
        for name in FEATURE_NAMES:
            values = []
            for r in row_list:
                val = r.get(name)
                if val is None:
                    val = NEUTRAL_VALUES.get(name, 0.0)
                values.append(float(val))
            result[name] = np.array(values)
        return result

    train_features = extract_features(train_rows)
    val_features = extract_features(val_rows)

    # Fit scaler on TRAINING DATA ONLY
    scaler = FeatureScaler()
    scaler.fit(train_features)

    # Transform both partitions using the SAME scaler
    X_train = scaler.transform_batch(train_features)
    X_val = scaler.transform_batch(val_features)

    # Append availability flags as additional features (ml-006 decision).
    # These are binary (0/1) and go through as-is (no normalization).
    # AVAIL_COLUMNS imported from features.py (single source of truth).
    avail_names = []
    for col in AVAIL_COLUMNS:
        if col in train_rows[0]:
            train_avail = np.array(
                [r.get(col, 1) for r in train_rows], dtype=np.float64,
            ).reshape(-1, 1)
            val_avail = np.array(
                [r.get(col, 1) for r in val_rows], dtype=np.float64,
            ).reshape(-1, 1)
            X_train = np.hstack([X_train, train_avail])
            X_val = np.hstack([X_val, val_avail])
            avail_names.append(col)

    all_feature_names = list(FEATURE_NAMES) + avail_names

    # Extract targets
    y_train = np.array(
        [r[target_column] for r in train_rows], dtype=np.float64,
    )
    y_val = np.array(
        [r[target_column] for r in val_rows], dtype=np.float64,
    )

    # Clip targets to [-20, +20]
    y_train = np.clip(y_train, -20.0, 20.0)
    y_val = np.clip(y_val, -20.0, 20.0)

    # Timestamps for walk-forward tracking
    train_ts = np.array([r["created_at"] for r in train_rows])
    val_ts = np.array([r["created_at"] for r in val_rows])

    log.info(
        "Prepared %d train + %d val samples for %s",
        len(train_rows), len(val_rows), target_column,
    )

    return TrainingData(
        X_train=X_train,
        y_train=y_train,
        X_val=X_val,
        y_val=y_val,
        scaler=scaler,
        train_timestamps=train_ts,
        val_timestamps=val_ts,
        feature_names=all_feature_names,
    )
