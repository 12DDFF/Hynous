"""Training script for condition prediction models.

Trains 10 condition models using walk-forward validation with the same
parameters proven in v7/v8 experiments. Run on VPS:

    python -m satellite.training.train_conditions

Each model predicts a different market condition (volatility, move size,
drawdown risk, etc.) using the same 14 structural features.
"""

import argparse
import hashlib
import json
import logging
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xgboost as xgb
from scipy.stats import spearmanr

from satellite.features import FEATURE_NAMES
from satellite.training.condition_artifact import (
    ConditionArtifact,
    ConditionMetadata,
    _compute_feature_hash,
)

log = logging.getLogger(__name__)

# ─── Target Definitions ──────────────────────────────────────────────────────

# Look-ahead constants (in snapshot indices, 1 index = 300s = 5min)
LOOK_1H = 12    # 12 * 5min = 60min
LOOK_4H = 48    # 48 * 5min = 240min
LOOK_30M = 6    # 6 * 5min = 30min


@dataclass
class ConditionTarget:
    """Definition of a single condition prediction target."""
    name: str
    description: str
    build_fn_name: str  # name of the function that computes the target


CONDITION_TARGETS: list[ConditionTarget] = [
    ConditionTarget("vol_1h", "Future realized_vol_1h (12 snapshots ahead)", "target_vol_1h"),
    ConditionTarget("vol_4h", "Avg realized_vol_1h over next 48 snapshots", "target_vol_4h"),
    ConditionTarget("range_30m", "abs(long_roe) + abs(short_roe) from 30m labels", "target_range_30m"),
    ConditionTarget("move_30m", "max(abs(long_roe), abs(short_roe)) from 30m labels", "target_move_30m"),
    ConditionTarget("volume_1h", "Future volume_vs_1h_avg_ratio (12 snapshots ahead)", "target_volume_1h"),
    ConditionTarget("entry_quality", "long_roe minus mean of recent 6 long_roes", "target_entry_quality"),
    ConditionTarget("mae_short", "abs(worst_short_mae_30m)", "target_mae_short"),
    ConditionTarget("vol_expand", "Future vol / current vol ratio", "target_vol_expand"),
    ConditionTarget("mae_long", "abs(worst_long_mae_30m)", "target_mae_long"),
    ConditionTarget("funding_4h", "Future funding_zscore minus current (48 ahead)", "target_funding_4h"),
]

# ─── XGBoost Parameters (proven in v7/v8 experiments) ────────────────────────

XGBOOST_PARAMS = {
    "objective": "reg:pseudohubererror",  # Huber loss — robust to outliers
    "max_depth": 4,
    "learning_rate": 0.03,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 10,
    "gamma": 0.1,
    "verbosity": 0,
}

# Targets with larger value ranges need more aggressive params (matching v7/v8 experiments)
XGBOOST_PARAMS_AGGRESSIVE = {
    "objective": "reg:squarederror",
    "max_depth": 5,
    "learning_rate": 0.1,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 5,
    "gamma": 0.0,
    "verbosity": 0,
}

# Targets that need aggressive params (ROE-scale values)
AGGRESSIVE_TARGETS = {"range_30m", "move_30m", "mae_long", "mae_short", "entry_quality"}

NUM_BOOST_ROUNDS = 500
EARLY_STOPPING_ROUNDS = 50

# Walk-forward parameters
MIN_TRAIN_DAYS = 60
TEST_DAYS = 14
STEP_DAYS = 7
SNAPSHOTS_PER_DAY = 288  # 24h * 60min / 5min


# ─── Data Loading ────────────────────────────────────────────────────────────

def load_snapshots_with_labels(db_path: str, coin: str) -> list[dict]:
    """Load all labeled snapshots for a coin, sorted by time ascending.

    Joins snapshots with snapshot_labels to get both features and outcome labels.

    Args:
        db_path: Path to satellite.db.
        coin: Coin symbol (e.g., "BTC").

    Returns:
        List of dicts with all feature columns + label columns, sorted by created_at.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT s.*, l.*
        FROM snapshots s
        JOIN snapshot_labels l ON s.snapshot_id = l.snapshot_id
        WHERE s.coin = ? AND l.label_version > 0
        ORDER BY s.created_at ASC
        """,
        (coin,),
    ).fetchall()

    conn.close()
    return [dict(row) for row in rows]


# ─── Target Builders ─────────────────────────────────────────────────────────

def build_condition_targets(rows: list[dict]) -> list[dict]:
    """Add all 10 forward-looking targets to snapshot rows.

    Each target uses look-ahead by index (not time) to build the
    forward-looking value. Rows without a valid target get None.

    Args:
        rows: Snapshots sorted by created_at ascending.

    Returns:
        Same rows with target columns added (may be None if look-ahead unavailable).
    """
    n = len(rows)

    for i, row in enumerate(rows):
        # 1. vol_1h: realized_vol_1h at index i+12
        row["target_vol_1h"] = _safe_get(rows, i + LOOK_1H, "realized_vol_1h")

        # 2. vol_4h: average realized_vol_1h over next 48 snapshots
        future_vols = [
            rows[j].get("realized_vol_1h")
            for j in range(i + 1, min(i + LOOK_4H + 1, n))
            if rows[j].get("realized_vol_1h") is not None
        ]
        row["target_vol_4h"] = float(np.mean(future_vols)) if len(future_vols) >= LOOK_1H else None

        # 3. range_30m: abs(best_long_roe_30m_gross) + abs(best_short_roe_30m_gross)
        long_roe = row.get("best_long_roe_30m_gross")
        short_roe = row.get("best_short_roe_30m_gross")
        if long_roe is not None and short_roe is not None:
            row["target_range_30m"] = abs(long_roe) + abs(short_roe)
        else:
            row["target_range_30m"] = None

        # 4. move_30m: max(abs(best_long_roe_30m_gross), abs(best_short_roe_30m_gross))
        if long_roe is not None and short_roe is not None:
            row["target_move_30m"] = max(abs(long_roe), abs(short_roe))
        else:
            row["target_move_30m"] = None

        # 5. volume_1h: volume_vs_1h_avg_ratio at index i+12
        row["target_volume_1h"] = _safe_get(rows, i + LOOK_1H, "volume_vs_1h_avg_ratio")

        # 6. entry_quality: long_roe minus mean of previous 6 long_roes
        current_roe = row.get("best_long_roe_30m_net")
        if current_roe is not None and i >= 6:
            recent_roes = [
                rows[j].get("best_long_roe_30m_net")
                for j in range(i - 6, i)
                if rows[j].get("best_long_roe_30m_net") is not None
            ]
            if len(recent_roes) >= 3:
                row["target_entry_quality"] = current_roe - float(np.mean(recent_roes))
            else:
                row["target_entry_quality"] = None
        else:
            row["target_entry_quality"] = None

        # 7. mae_short: abs(worst_short_mae_30m)
        mae_s = row.get("worst_short_mae_30m")
        row["target_mae_short"] = abs(mae_s) if mae_s is not None else None

        # 8. vol_expand: future_vol / current_vol ratio
        future_vol = _safe_get(rows, i + LOOK_1H, "realized_vol_1h")
        current_vol = row.get("realized_vol_1h")
        if future_vol is not None and current_vol is not None and current_vol > 1e-8:
            row["target_vol_expand"] = future_vol / current_vol
        else:
            row["target_vol_expand"] = None

        # 9. mae_long: abs(worst_long_mae_30m)
        mae_l = row.get("worst_long_mae_30m")
        row["target_mae_long"] = abs(mae_l) if mae_l is not None else None

        # 10. funding_4h: future_funding_zscore - current_funding_zscore
        future_funding = _safe_get(rows, i + LOOK_4H, "funding_vs_30d_zscore")
        current_funding = row.get("funding_vs_30d_zscore")
        if future_funding is not None and current_funding is not None:
            row["target_funding_4h"] = future_funding - current_funding
        else:
            row["target_funding_4h"] = None

    return rows


def _safe_get(rows: list[dict], idx: int, key: str):
    """Safely get a value from a row by index. Returns None if out of bounds or missing."""
    if idx < 0 or idx >= len(rows):
        return None
    return rows[idx].get(key)


# ─── Walk-Forward Training ───────────────────────────────────────────────────

def train_single_condition(
    rows: list[dict],
    target: ConditionTarget,
    feature_names: list[str],
    output_dir: Path,
) -> dict:
    """Train one condition model with walk-forward validation.

    Args:
        rows: All snapshots with targets built (from build_condition_targets).
        target: The condition target definition.
        feature_names: List of feature column names.
        output_dir: Base artifacts directory (e.g. artifacts/conditions/).

    Returns:
        Dict with training results (avg_spearman, avg_mae, generation_count).
    """
    target_col = target.build_fn_name  # e.g. "target_vol_1h"

    # Filter to rows with valid target and features
    valid_rows = []
    for row in rows:
        target_val = row.get(target_col)
        if target_val is None:
            continue
        features_ok = all(
            row.get(f) is not None for f in feature_names
        )
        if features_ok:
            valid_rows.append(row)

    if len(valid_rows) < (MIN_TRAIN_DAYS + TEST_DAYS) * SNAPSHOTS_PER_DAY:
        log.warning(
            "Insufficient data for %s: %d rows (need %d)",
            target.name,
            len(valid_rows),
            (MIN_TRAIN_DAYS + TEST_DAYS) * SNAPSHOTS_PER_DAY,
        )
        return {"name": target.name, "status": "skipped", "reason": "insufficient_data"}

    # Build feature matrix and target vector
    X = np.array(
        [[row[f] for f in feature_names] for row in valid_rows],
        dtype=np.float32,
    )
    y = np.array(
        [row[target_col] for row in valid_rows],
        dtype=np.float32,
    )

    # Clip extreme targets
    p1, p99 = np.percentile(y, [1, 99])
    y = np.clip(y, p1, p99)

    # Walk-forward validation
    min_train = MIN_TRAIN_DAYS * SNAPSHOTS_PER_DAY
    test_window = TEST_DAYS * SNAPSHOTS_PER_DAY
    step = STEP_DAYS * SNAPSHOTS_PER_DAY

    results = []

    for gen, test_start in enumerate(range(min_train, len(X) - test_window, step)):
        test_end = test_start + test_window

        X_train, y_train = X[:test_start], y[:test_start]
        X_test, y_test = X[test_start:test_end], y[test_start:test_end]

        # Select params based on target type
        params = (
            XGBOOST_PARAMS_AGGRESSIVE
            if target.name in AGGRESSIVE_TARGETS
            else XGBOOST_PARAMS
        )

        # Train XGBoost with early stopping
        dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=feature_names)
        dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_names)

        model = xgb.train(
            params,
            dtrain,
            num_boost_round=NUM_BOOST_ROUNDS,
            evals=[(dtest, "test")],
            early_stopping_rounds=EARLY_STOPPING_ROUNDS,
            verbose_eval=False,
        )

        y_pred = model.predict(dtest)

        # Evaluate
        sp, _ = spearmanr(y_test, y_pred)
        mae = float(np.mean(np.abs(y_test - y_pred)))
        centered_dir = 100 * float(np.mean(
            np.sign(y_test - np.mean(y_test)) == np.sign(y_pred - np.mean(y_pred))
        ))

        results.append({
            "generation": gen,
            "spearman": round(sp, 4),
            "mae": round(mae, 4),
            "centered_dir": round(centered_dir, 1),
            "rounds": model.best_iteration + 1 if hasattr(model, "best_iteration") else NUM_BOOST_ROUNDS,
        })

        log.info(
            "  Gen %d: centered=%.1f%% spearman=%.4f mae=%.4f rounds=%d",
            gen, centered_dir, sp, mae, results[-1]["rounds"],
        )

    if not results:
        log.warning("No walk-forward generations completed for %s", target.name)
        return {"name": target.name, "status": "failed", "reason": "no_generations"}

    # Average metrics across generations (filter NaN spearman values)
    valid_spearmans = [r["spearman"] for r in results if not np.isnan(r["spearman"])]
    avg_spearman = float(np.mean(valid_spearmans)) if valid_spearmans else 0.0
    avg_mae = float(np.mean([r["mae"] for r in results]))
    avg_centered = float(np.mean([r["centered_dir"] for r in results]))

    log.info(
        "%s: AVG spearman=%.4f mae=%.4f centered=%.1f%% (%d gens)",
        target.name, avg_spearman, avg_mae, avg_centered, len(results),
    )

    # Train final model on ALL data
    final_params = (
        XGBOOST_PARAMS_AGGRESSIVE
        if target.name in AGGRESSIVE_TARGETS
        else XGBOOST_PARAMS
    )
    dtrain_full = xgb.DMatrix(X, label=y, feature_names=feature_names)
    # Use median best_iteration from walk-forward as final round count
    median_rounds = int(np.median([r["rounds"] for r in results]))
    final_model = xgb.train(
        final_params,
        dtrain_full,
        num_boost_round=max(median_rounds, 50),
        verbose_eval=False,
    )

    # Compute training-set percentiles for regime labeling
    y_pred_full = final_model.predict(dtrain_full)
    percentiles = {
        f"p{p}": round(float(np.percentile(y_pred_full, p)), 6)
        for p in [10, 25, 50, 75, 90, 95]
    }

    # Build and save artifact
    feature_hash = _compute_feature_hash(feature_names)
    metadata = ConditionMetadata(
        name=target.name,
        version=1,
        feature_hash=feature_hash,
        feature_names=feature_names,
        target_description=target.description,
        created_at=datetime.now(timezone.utc).isoformat(),
        training_samples=len(X),
        validation_spearman=round(avg_spearman, 4),
        validation_mae=round(avg_mae, 4),
        xgboost_params=XGBOOST_PARAMS,
        percentiles=percentiles,
    )

    artifact = ConditionArtifact(model=final_model, metadata=metadata)
    artifact.save(output_dir)

    return {
        "name": target.name,
        "status": "success",
        "avg_spearman": avg_spearman,
        "avg_mae": avg_mae,
        "avg_centered_dir": avg_centered,
        "generations": len(results),
        "training_samples": len(X),
        "median_rounds": median_rounds,
        "results": results,
    }


# ─── Entry Point ─────────────────────────────────────────────────────────────

def train_all_conditions(
    db_path: str,
    output_dir: str,
    coin: str = "BTC",
    targets: list[str] | None = None,
) -> list[dict]:
    """Train all condition models for a coin.

    Args:
        db_path: Path to satellite.db.
        output_dir: Path to artifacts/conditions/ directory.
        coin: Coin to train on (default "BTC").
        targets: Optional list of target names to train (default: all 10).

    Returns:
        List of per-model training results.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    log.info("Loading snapshots for %s from %s...", coin, db_path)
    rows = load_snapshots_with_labels(db_path, coin)
    log.info("Loaded %d labeled snapshots", len(rows))

    if not rows:
        log.error("No labeled snapshots found for %s", coin)
        return []

    log.info("Building condition targets...")
    rows = build_condition_targets(rows)

    # Filter targets if specified
    active_targets = CONDITION_TARGETS
    if targets:
        active_targets = [t for t in CONDITION_TARGETS if t.name in targets]
        log.info("Training subset: %s", [t.name for t in active_targets])

    feature_names = list(FEATURE_NAMES)
    results = []

    for target in active_targets:
        log.info("=" * 60)
        log.info("Training: %s — %s", target.name, target.description)
        log.info("=" * 60)

        result = train_single_condition(rows, target, feature_names, output_path)
        results.append(result)

    # Summary
    log.info("\n" + "=" * 60)
    log.info("TRAINING SUMMARY")
    log.info("=" * 60)
    for r in results:
        if r.get("status") == "success":
            log.info(
                "  %-15s spearman=%.4f  mae=%.4f  centered=%.1f%%  (%d gens, %d samples)",
                r["name"],
                r["avg_spearman"],
                r["avg_mae"],
                r["avg_centered_dir"],
                r["generations"],
                r["training_samples"],
            )
        else:
            log.info("  %-15s %s: %s", r["name"], r.get("status"), r.get("reason", ""))

    return results


def main():
    parser = argparse.ArgumentParser(description="Train condition prediction models")
    parser.add_argument(
        "--db", default="storage/satellite.db",
        help="Path to satellite.db (default: storage/satellite.db)",
    )
    parser.add_argument(
        "--output", default="satellite/artifacts/conditions",
        help="Output directory for model artifacts",
    )
    parser.add_argument(
        "--coin", default="BTC",
        help="Coin to train on (default: BTC)",
    )
    parser.add_argument(
        "--targets", nargs="+", default=None,
        help="Specific targets to train (default: all 10)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    train_all_conditions(args.db, args.output, args.coin, args.targets)


if __name__ == "__main__":
    main()
