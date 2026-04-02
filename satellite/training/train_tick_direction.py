"""Training script for tick-level direction prediction models.

Trains XGBoost regression models to predict short-horizon price returns
(60s, 120s, 180s) from tick-level microstructure features (orderbook
imbalance, trade flow, book pressure delta, etc.).

Uses the same walk-forward validation pattern as train_conditions.py
but adapted for 1-second resolution tick data.

Usage:
    python -m satellite.training.train_tick_direction --db storage/satellite.db

    # Specific horizons:
    python -m satellite.training.train_tick_direction --horizons 60,120

    # Custom walk-forward:
    python -m satellite.training.train_tick_direction --train-days 5 --test-days 1
"""

import argparse
import hashlib
import json
import logging
import sqlite3
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xgboost as xgb
from scipy.stats import spearmanr

log = logging.getLogger(__name__)

# ─── Tick Feature Names ─────────────────────────────────────────────────────
# Canonical source: satellite/tick_features.py
from satellite.tick_features import TICK_FEATURE_NAMES as BASE_TICK_FEATURES, ROLLING_FEATURES

ALL_FEATURES = BASE_TICK_FEATURES + ROLLING_FEATURES

# Drop mid_price from model features — it's used for labels, not prediction.
# The model should learn from orderbook/flow structure, not price level.
MODEL_FEATURES = [f for f in ALL_FEATURES if f != "mid_price"]

# ─── Horizons ────────────────────────────────────────────────────────────────

@dataclass
class TickTarget:
    """Definition of a tick direction prediction target."""
    name: str
    horizon_seconds: int
    description: str


DEFAULT_TARGETS = [
    TickTarget("direction_60s", 60, "Price return 60s forward (basis points)"),
    TickTarget("direction_120s", 120, "Price return 120s forward (basis points)"),
    TickTarget("direction_180s", 180, "Price return 180s forward (basis points)"),
]

# ─── XGBoost Parameters ─────────────────────────────────────────────────────

XGBOOST_PARAMS = {
    "objective": "reg:pseudohubererror",  # Huber loss — robust to outliers
    "max_depth": 5,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 10,
    "gamma": 0.1,
    "verbosity": 0,
}

NUM_BOOST_ROUNDS = 500
EARLY_STOPPING_ROUNDS = 50

# Walk-forward parameters (tick-scale)
DOWNSAMPLE_INTERVAL = 5     # seconds — train on every 5th tick (matches write interval)
MIN_TRAIN_DAYS = 4          # minimum training window
TEST_DAYS = 1               # test window
STEP_DAYS = 1               # advance by 1 day
EMBARGO_SECONDS = 6 * 3600  # 6h gap (generous: longest label is 180s)
VAL_FRACTION = 0.20         # 20% of train for early stopping

TICKS_PER_DAY = 86400 // DOWNSAMPLE_INTERVAL  # 17280 at 5s resolution


# ─── Data Loading ────────────────────────────────────────────────────────────

def load_tick_data(db_path: str, coin: str = "BTC") -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Load tick snapshots, downsample, compute rolling features and labels.

    Returns:
        X: Feature matrix (N, F) — float32
        timestamps: Array of unix timestamps (N,)
        feature_names: List of feature column names
    """
    log.info("Loading tick data from %s for %s...", db_path, coin)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Load v2 tick snapshots (v1 rows lack v2 features)
    rows = conn.execute(
        """
        SELECT * FROM tick_snapshots
        WHERE coin = ? AND schema_version = 2
        ORDER BY timestamp ASC
        """,
        (coin,),
    ).fetchall()
    conn.close()

    if not rows:
        log.error("No v2 tick snapshots found")
        return np.array([]), np.array([]), []

    log.info("Loaded %d v2 tick rows (%.1f days)",
             len(rows), (rows[-1]["timestamp"] - rows[0]["timestamp"]) / 86400)

    # Downsample to DOWNSAMPLE_INTERVAL seconds
    downsampled = _downsample(rows, DOWNSAMPLE_INTERVAL)
    log.info("Downsampled to %d rows (%ds interval)", len(downsampled), DOWNSAMPLE_INTERVAL)

    # Extract base features + timestamps
    timestamps = np.array([r["timestamp"] for r in downsampled], dtype=np.float64)
    base_matrix = np.array(
        [[r[f] or 0.0 for f in BASE_TICK_FEATURES] for r in downsampled],
        dtype=np.float32,
    )

    # Compute rolling aggregate features
    rolling_matrix = _compute_rolling_features(base_matrix, timestamps)

    # Combine base + rolling
    X = np.hstack([base_matrix, rolling_matrix])
    feature_names = BASE_TICK_FEATURES + ROLLING_FEATURES

    log.info("Feature matrix: %d rows x %d features", X.shape[0], X.shape[1])
    return X, timestamps, feature_names


def _downsample(rows: list, interval_s: int) -> list:
    """Keep one row per interval (closest to interval boundary)."""
    if not rows:
        return []
    result = [rows[0]]
    last_t = rows[0]["timestamp"]
    for r in rows[1:]:
        if r["timestamp"] - last_t >= interval_s - 0.5:
            result.append(r)
            last_t = r["timestamp"]
    return result


def _compute_rolling_features(base: np.ndarray, timestamps: np.ndarray) -> np.ndarray:
    """Compute rolling mean/std/slope features from base feature matrix.

    Uses only backward-looking windows (no future leakage).
    """
    n = len(base)
    # Map feature names to column indices
    col = {f: i for i, f in enumerate(BASE_TICK_FEATURES)}

    # Windows in ticks (at downsampled resolution)
    w5 = max(1, 5 // DOWNSAMPLE_INTERVAL)      # 5s window
    w10 = max(1, 10 // DOWNSAMPLE_INTERVAL)     # 10s window
    w30 = max(1, 30 // DOWNSAMPLE_INTERVAL)     # 30s window
    w60 = max(1, 60 // DOWNSAMPLE_INTERVAL)     # 60s window

    rolling = np.zeros((n, len(ROLLING_FEATURES)), dtype=np.float32)

    # Pre-extract columns for speed
    book_imb = base[:, col["book_imbalance_5"]]
    flow_imb = base[:, col["flow_imbalance_10s"]]
    price_chg = base[:, col["price_change_10s"]]
    mid = base[:, col["mid_price"]]

    # Rolling means
    rolling[:, 0] = _rolling_mean(book_imb, w5)    # book_imbalance_5_mean5
    rolling[:, 1] = _rolling_mean(flow_imb, w5)     # flow_imbalance_10s_mean5
    rolling[:, 2] = _rolling_mean(price_chg, w5)    # price_change_10s_mean5
    rolling[:, 3] = _rolling_mean(book_imb, w10)    # book_imbalance_5_mean10
    rolling[:, 4] = _rolling_mean(flow_imb, w10)    # flow_imbalance_10s_mean10

    # Rolling stds
    rolling[:, 5] = _rolling_std(book_imb, w30)     # book_imbalance_5_std30
    rolling[:, 6] = _rolling_std(flow_imb, w30)     # flow_imbalance_10s_std30
    rolling[:, 7] = _rolling_std(price_chg, w30)    # price_change_10s_std30

    # Rolling slopes (linear regression slope over window)
    rolling[:, 8] = _rolling_slope(book_imb, w60)   # book_imbalance_5_slope60
    rolling[:, 9] = _rolling_slope(flow_imb, w60)   # flow_imbalance_10s_slope60
    rolling[:, 10] = _rolling_slope(mid, w60)        # mid_price_slope60

    return rolling


def _rolling_mean(x: np.ndarray, window: int) -> np.ndarray:
    """Backward-looking rolling mean."""
    if window <= 1:
        return x.copy()
    cumsum = np.cumsum(np.insert(x, 0, 0))
    result = np.zeros_like(x)
    for i in range(len(x)):
        start = max(0, i - window + 1)
        result[i] = (cumsum[i + 1] - cumsum[start]) / (i - start + 1)
    return result


def _rolling_std(x: np.ndarray, window: int) -> np.ndarray:
    """Backward-looking rolling standard deviation."""
    result = np.zeros_like(x)
    for i in range(len(x)):
        start = max(0, i - window + 1)
        if i - start < 2:
            result[i] = 0.0
        else:
            result[i] = np.std(x[start:i + 1])
    return result


def _rolling_slope(x: np.ndarray, window: int) -> np.ndarray:
    """Backward-looking linear regression slope (units per tick)."""
    result = np.zeros_like(x)
    for i in range(len(x)):
        start = max(0, i - window + 1)
        n = i - start + 1
        if n < 3:
            result[i] = 0.0
        else:
            t = np.arange(n, dtype=np.float32)
            seg = x[start:i + 1]
            # Simple OLS: slope = cov(t, y) / var(t)
            t_mean = t.mean()
            y_mean = seg.mean()
            cov = np.sum((t - t_mean) * (seg - y_mean))
            var = np.sum((t - t_mean) ** 2)
            result[i] = cov / var if var > 0 else 0.0
    return result


# ─── Label Construction ──────────────────────────────────────────────────────

def compute_labels(
    timestamps: np.ndarray,
    mid_prices: np.ndarray,
    horizon_seconds: int,
) -> np.ndarray:
    """Compute forward-looking return labels (basis points).

    For each row i, find the row closest to timestamps[i] + horizon_seconds
    and compute: (mid_price_future - mid_price_now) / mid_price_now * 10000

    Returns NaN where future data is unavailable.
    """
    n = len(timestamps)
    labels = np.full(n, np.nan, dtype=np.float32)

    # Since timestamps are sorted and ~evenly spaced, use search
    target_times = timestamps + horizon_seconds
    future_indices = np.searchsorted(timestamps, target_times)

    for i in range(n):
        j = future_indices[i]
        if j >= n:
            continue
        # Check the match is within tolerance (±half the downsample interval)
        if abs(timestamps[j] - target_times[i]) <= DOWNSAMPLE_INTERVAL:
            if mid_prices[i] > 0:
                labels[i] = (mid_prices[j] - mid_prices[i]) / mid_prices[i] * 10000
        # Also check j-1 for closer match
        elif j > 0 and abs(timestamps[j - 1] - target_times[i]) <= DOWNSAMPLE_INTERVAL:
            if mid_prices[i] > 0:
                labels[i] = (mid_prices[j - 1] - mid_prices[i]) / mid_prices[i] * 10000

    valid = np.sum(~np.isnan(labels))
    log.info("Labels (%ds horizon): %d/%d valid (%.1f%%)",
             horizon_seconds, valid, n, valid / n * 100)
    return labels


# ─── Walk-Forward Training ───────────────────────────────────────────────────

def train_tick_direction(
    X: np.ndarray,
    timestamps: np.ndarray,
    feature_names: list[str],
    target: TickTarget,
    mid_prices: np.ndarray,
    output_dir: Path,
    train_days: int = MIN_TRAIN_DAYS,
    test_days: int = TEST_DAYS,
) -> dict:
    """Train one tick direction model with walk-forward validation.

    Same structure as train_conditions.py:train_single_condition.
    """
    log.info("Training %s (horizon=%ds)...", target.name, target.horizon_seconds)

    # Drop mid_price from features
    model_features = [f for f in feature_names if f != "mid_price"]
    feat_indices = [feature_names.index(f) for f in model_features]
    X_model = X[:, feat_indices]

    # Compute labels
    labels = compute_labels(timestamps, mid_prices, target.horizon_seconds)

    # Filter to rows with valid labels
    valid_mask = ~np.isnan(labels)
    X_valid = X_model[valid_mask]
    y_valid = labels[valid_mask]
    t_valid = timestamps[valid_mask]

    log.info("Valid samples: %d/%d (%.1f%%)", len(X_valid), len(X_model),
             len(X_valid) / len(X_model) * 100)

    # Walk-forward
    min_train = train_days * TICKS_PER_DAY
    test_window = test_days * TICKS_PER_DAY
    step = STEP_DAYS * TICKS_PER_DAY
    embargo = EMBARGO_SECONDS // DOWNSAMPLE_INTERVAL

    if len(X_valid) < min_train + embargo + test_window:
        log.warning("Insufficient data: %d rows (need %d)",
                    len(X_valid), min_train + embargo + test_window)
        return {"name": target.name, "status": "insufficient_data",
                "rows": len(X_valid), "needed": min_train + embargo + test_window}

    results = []
    for gen, train_end in enumerate(range(min_train, len(X_valid) - embargo - test_window, step)):
        test_start = train_end + embargo
        test_end = min(test_start + test_window, len(X_valid))

        if test_end - test_start < TICKS_PER_DAY // 2:
            break

        # Split train → train + val for early stopping
        val_size = max(int(train_end * VAL_FRACTION), TICKS_PER_DAY // 2)
        val_start = train_end - val_size

        X_train, y_train = X_valid[:val_start], y_valid[:val_start].copy()
        X_val, y_val = X_valid[val_start:train_end], y_valid[val_start:train_end].copy()
        X_test, y_test = X_valid[test_start:test_end], y_valid[test_start:test_end]

        # Per-fold target clipping (remove extreme outliers)
        p1, p99 = np.percentile(y_train, [1, 99])
        y_train = np.clip(y_train, p1, p99)
        y_val = np.clip(y_val, p1, p99)
        # DO NOT clip y_test

        dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=model_features)
        dval = xgb.DMatrix(X_val, label=y_val, feature_names=model_features)
        dtest = xgb.DMatrix(X_test, label=y_test, feature_names=model_features)

        model = xgb.train(
            XGBOOST_PARAMS,
            dtrain,
            num_boost_round=NUM_BOOST_ROUNDS,
            evals=[(dval, "val")],
            early_stopping_rounds=EARLY_STOPPING_ROUNDS,
            verbose_eval=False,
        )

        y_pred = model.predict(dtest)

        # Metrics
        sp, sp_pval = spearmanr(y_test, y_pred)
        if np.isnan(sp):
            sp, sp_pval = 0.0, 1.0
        mae = float(np.mean(np.abs(y_test - y_pred)))

        # Directional accuracy on significant moves (>3 bps)
        sig_mask = np.abs(y_test) > 3.0
        if sig_mask.sum() > 100:
            dir_acc = float(np.mean(np.sign(y_test[sig_mask]) == np.sign(y_pred[sig_mask]))) * 100
        else:
            dir_acc = 50.0

        # Profit simulation: if we trade in predicted direction, what's the avg P&L?
        # Positive = model makes money, negative = loses money
        avg_pnl_bps = float(np.mean(np.sign(y_pred) * y_test))

        results.append({
            "generation": gen,
            "spearman": round(sp, 4),
            "spearman_pval": round(float(sp_pval), 6),
            "mae_bps": round(mae, 2),
            "dir_accuracy": round(dir_acc, 1),
            "avg_pnl_bps": round(avg_pnl_bps, 3),
            "sig_moves": int(sig_mask.sum()),
            "rounds": model.best_iteration + 1 if hasattr(model, "best_iteration") else NUM_BOOST_ROUNDS,
            "train_size": len(X_train),
            "test_size": len(X_test),
            "train_range": f"{t_valid[0]:.0f}-{t_valid[val_start - 1]:.0f}",
            "test_range": f"{t_valid[test_start]:.0f}-{t_valid[test_end - 1]:.0f}",
        })

        log.info(
            "  Gen %d: sp=%.4f  dir=%.1f%%  pnl=%.3f bps  mae=%.1f bps  rounds=%d  (train=%d test=%d sig=%d)",
            gen, sp, dir_acc, avg_pnl_bps, mae,
            results[-1]["rounds"], len(X_train), len(X_test), int(sig_mask.sum()),
        )

    if not results:
        log.warning("No walk-forward generations completed for %s", target.name)
        return {"name": target.name, "status": "no_generations"}

    # Summary
    avg_sp = float(np.mean([r["spearman"] for r in results]))
    avg_dir = float(np.mean([r["dir_accuracy"] for r in results]))
    avg_pnl = float(np.mean([r["avg_pnl_bps"] for r in results]))
    std_sp = float(np.std([r["spearman"] for r in results]))

    log.info(
        "%s RESULT: sp=%.4f±%.4f  dir=%.1f%%  pnl=%.3f bps  (%d gens)",
        target.name, avg_sp, std_sp, avg_dir, avg_pnl, len(results),
    )

    # Assess
    if avg_sp > 0.06:
        verdict = "PASS — deploy candidate"
    elif avg_sp > 0.03:
        verdict = "MARGINAL — needs more data"
    else:
        verdict = "FAIL — no signal"
    log.info("%s VERDICT: %s", target.name, verdict)

    # Train final model on ALL data (if passing)
    artifact_path = None
    if avg_sp > 0.03:
        y_final = y_valid.copy()
        p1_f, p99_f = np.percentile(y_final, [1, 99])
        y_final = np.clip(y_final, p1_f, p99_f)

        dtrain_full = xgb.DMatrix(X_valid, label=y_final, feature_names=model_features)
        median_rounds = int(np.median([r["rounds"] for r in results]))
        final_model = xgb.train(
            XGBOOST_PARAMS,
            dtrain_full,
            num_boost_round=max(median_rounds, 50),
            verbose_eval=False,
        )

        # Percentiles for regime labeling
        y_pred_full = final_model.predict(dtrain_full)
        percentiles = {
            f"p{p}": round(float(np.percentile(y_pred_full, p)), 6)
            for p in [10, 25, 50, 75, 90, 95]
        }

        # Save artifact
        model_dir = output_dir / target.name
        model_dir.mkdir(parents=True, exist_ok=True)

        final_model.save_model(str(model_dir / "model.json"))

        feature_hash = hashlib.sha256("|".join(model_features).encode()).hexdigest()[:16]
        metadata = {
            "name": target.name,
            "version": 1,
            "type": "tick_direction",
            "horizon_seconds": target.horizon_seconds,
            "feature_hash": feature_hash,
            "feature_names": model_features,
            "target_description": target.description,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "training_samples": len(X_valid),
            "validation_spearman": round(avg_sp, 4),
            "validation_spearman_std": round(std_sp, 4),
            "validation_dir_accuracy": round(avg_dir, 1),
            "validation_avg_pnl_bps": round(avg_pnl, 3),
            "xgboost_params": XGBOOST_PARAMS,
            "downsample_interval": DOWNSAMPLE_INTERVAL,
            "percentiles": percentiles,
            "walk_forward_results": results,
        }
        with open(model_dir / "metadata.json", "w") as f:
            json.dump(metadata, f, indent=2)

        artifact_path = str(model_dir)
        log.info("Saved artifact to %s", artifact_path)

    return {
        "name": target.name,
        "status": verdict,
        "avg_spearman": avg_sp,
        "spearman_std": std_sp,
        "avg_dir_accuracy": avg_dir,
        "avg_pnl_bps": avg_pnl,
        "generations": len(results),
        "training_samples": len(X_valid),
        "artifact_path": artifact_path,
        "results": results,
    }


# ─── Entry Point ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train tick direction models")
    parser.add_argument("--db", default="storage/satellite.db", help="Path to satellite.db")
    parser.add_argument("--coin", default="BTC")
    parser.add_argument("--horizons", default="60,120,180",
                        help="Comma-separated horizons in seconds")
    parser.add_argument("--output", default="satellite/artifacts/tick_models",
                        help="Output directory for model artifacts")
    parser.add_argument("--train-days", type=int, default=MIN_TRAIN_DAYS)
    parser.add_argument("--test-days", type=int, default=TEST_DAYS)
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    db_path = args.db
    if not Path(db_path).exists():
        log.error("Database not found: %s", db_path)
        sys.exit(1)

    horizons = [int(h) for h in args.horizons.split(",")]
    targets = [TickTarget(f"direction_{h}s", h, f"Price return {h}s forward (bps)")
               for h in horizons]

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load data once — all horizons share the same feature matrix
    X, timestamps, feature_names = load_tick_data(db_path, args.coin)
    if len(X) == 0:
        log.error("No data loaded")
        sys.exit(1)

    # Extract mid_price for label computation
    mid_idx = feature_names.index("mid_price")
    mid_prices = X[:, mid_idx]

    # Train each horizon
    all_results = []
    for target in targets:
        result = train_tick_direction(
            X, timestamps, feature_names, target, mid_prices,
            output_dir, args.train_days, args.test_days,
        )
        all_results.append(result)
        log.info("")

    # Summary
    log.info("=" * 60)
    log.info("SUMMARY")
    log.info("=" * 60)
    for r in all_results:
        sp = r.get("avg_spearman", 0)
        da = r.get("avg_dir_accuracy", 0)
        pnl = r.get("avg_pnl_bps", 0)
        log.info("  %-20s sp=%.4f  dir=%.1f%%  pnl=%.3f bps  [%s]",
                 r["name"], sp, da, pnl, r["status"])

    # Save summary
    summary_path = output_dir / "training_summary.json"
    with open(summary_path, "w") as f:
        json.dump(all_results, f, indent=2)
    log.info("Summary saved to %s", summary_path)


if __name__ == "__main__":
    main()
