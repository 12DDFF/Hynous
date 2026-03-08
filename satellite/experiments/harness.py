"""Shared experiment harness for ML model discovery.

Provides walk-forward training, evaluation, and reporting that all
experiments share. Each experiment only needs to define:
  1. Target computation function
  2. Feature list
  3. XGBoost params

Statistical safeguards:
  - 3-way split: train / validation (early stopping) / test (evaluation only)
  - Embargo gap between train and test (prevents label leakage from
    overlapping forward-looking windows like 4h labels, 30m MAE, etc.)
  - Per-fold target clipping (no future percentile leakage)
  - Permutation baseline (shuffle target, re-run, compare)
  - Proper binary metrics (AUC-ROC, Brier score) alongside Spearman
  - Spearman p-value significance check (reject if p > 0.05)
  - Per-generation stability check (flag if std > mean)
"""

import json
import logging
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xgboost as xgb
from scipy.stats import spearmanr

from satellite.features import FEATURE_NAMES

log = logging.getLogger(__name__)

# Walk-forward defaults (same as proven condition training)
MIN_TRAIN_DAYS = 60
TEST_DAYS = 14
STEP_DAYS = 7
SNAPSHOTS_PER_DAY = 288

# Embargo: gap between train end and test start to prevent label leakage.
# Longest forward-looking label is 4h = 48 snapshots.  We add 48 snapshots
# (~4h) of dead zone so no training label overlaps with the test period.
EMBARGO_SNAPSHOTS = 48

# Validation split: last 20% of training window used for early stopping.
# This keeps the test set completely untouched during training.
VAL_FRACTION = 0.20

# Standard XGBoost params
XGBOOST_HUBER = {
    "objective": "reg:pseudohubererror",
    "max_depth": 4,
    "learning_rate": 0.03,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 10,
    "gamma": 0.1,
    "verbosity": 0,
}

XGBOOST_AGGRESSIVE = {
    "objective": "reg:squarederror",
    "max_depth": 5,
    "learning_rate": 0.1,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 5,
    "gamma": 0.0,
    "verbosity": 0,
}

XGBOOST_BINARY = {
    "objective": "binary:logistic",
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 10,
    "gamma": 0.1,
    "eval_metric": "auc",
    "verbosity": 0,
}

NUM_BOOST_ROUNDS = 500
EARLY_STOPPING_ROUNDS = 50

# Permutation test: number of shuffled-target runs to establish null
PERMUTATION_RUNS = 3


@dataclass
class ExperimentResult:
    """Result of a single walk-forward generation."""
    generation: int
    spearman: float
    spearman_pval: float
    mae: float
    centered_dir: float
    rounds: int
    train_size: int
    val_size: int
    test_size: int
    # Binary-specific metrics (None for regression)
    auc_roc: float | None = None
    brier_score: float | None = None
    precision_at_50: float | None = None


@dataclass
class ExperimentSummary:
    """Full experiment output."""
    name: str
    description: str
    feature_count: int
    avg_spearman: float
    avg_mae: float
    avg_centered_dir: float
    spearman_std: float
    generations: int
    total_samples: int
    results: list[ExperimentResult]
    verdict: str  # "PASS", "MARGINAL", "FAIL"
    feature_importance: dict[str, float]
    # Permutation baseline
    baseline_spearman: float = 0.0
    lift_over_baseline: float = 0.0
    # Stability
    significant_generations: int = 0  # gens where p < 0.05


def load_snapshots_with_labels(db_path: str, coin: str) -> list[dict]:
    """Load all labeled snapshots for a coin, sorted by time ascending."""
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


def load_simulated_exits(db_path: str, coin: str) -> list[dict]:
    """Load all simulated exit rows for a coin."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT se.*, s.created_at as snap_created_at,
               s.oi_vs_7d_avg_ratio, s.liq_cascade_active, s.liq_1h_vs_4h_avg,
               s.funding_vs_30d_zscore, s.hours_to_funding, s.oi_funding_pressure,
               s.volume_vs_1h_avg_ratio, s.realized_vol_1h,
               s.cvd_ratio_30m, s.cvd_acceleration, s.price_trend_1h,
               s.close_position_5m, s.oi_price_direction, s.liq_imbalance_1h
        FROM simulated_exits se
        JOIN snapshots s ON se.snapshot_id = s.snapshot_id
        WHERE se.coin = ?
        ORDER BY s.created_at ASC, se.checkpoint_time ASC
        """,
        (coin,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def _compute_binary_metrics(y_true: np.ndarray, y_prob: np.ndarray) -> dict:
    """Compute AUC-ROC, Brier score, precision@50% for binary predictions."""
    from sklearn.metrics import roc_auc_score, brier_score_loss

    metrics: dict = {}
    try:
        metrics["auc_roc"] = round(float(roc_auc_score(y_true, y_prob)), 4)
    except ValueError:
        metrics["auc_roc"] = None  # single class in fold

    metrics["brier_score"] = round(float(brier_score_loss(y_true, y_prob)), 4)

    # Precision at 50% threshold
    y_pred_binary = (y_prob >= 0.5).astype(int)
    tp = ((y_pred_binary == 1) & (y_true == 1)).sum()
    fp = ((y_pred_binary == 1) & (y_true == 0)).sum()
    metrics["precision_at_50"] = round(float(tp / (tp + fp)), 4) if (tp + fp) > 0 else None

    return metrics


def run_walkforward(
    X: np.ndarray,
    y: np.ndarray,
    feature_names: list[str],
    params: dict,
    experiment_name: str,
    is_binary: bool = False,
    embargo: int = EMBARGO_SNAPSHOTS,
) -> tuple[list[ExperimentResult], dict[str, float]]:
    """Run walk-forward validation with proper statistical safeguards.

    Split structure per generation:
        [===== TRAIN =====][= VAL =][/// EMBARGO ///][==== TEST ====]
        ^                  ^        ^                 ^              ^
        0              val_start  train_end     test_start      test_end

    - TRAIN: model learns from this data
    - VAL: early stopping only (model never trains on this)
    - EMBARGO: dead zone, prevents label leakage from overlapping windows
    - TEST: evaluation only, model never sees these labels

    Args:
        X: Feature matrix (n_samples, n_features).
        y: Target vector.
        feature_names: Feature names for each column.
        params: XGBoost params dict.
        experiment_name: For logging.
        is_binary: If True, compute AUC/Brier alongside Spearman.
        embargo: Number of snapshots to skip between train and test.

    Returns:
        Tuple of (results_list, avg_feature_importance_dict).
    """
    min_train = MIN_TRAIN_DAYS * SNAPSHOTS_PER_DAY
    test_window = TEST_DAYS * SNAPSHOTS_PER_DAY
    step = STEP_DAYS * SNAPSHOTS_PER_DAY

    # Need enough room for train + embargo + test
    min_data = min_train + embargo + test_window
    if len(X) < min_data:
        log.error(
            "%s: insufficient data — %d rows, need %d (train=%d + embargo=%d + test=%d)",
            experiment_name, len(X), min_data, min_train, embargo, test_window,
        )
        return [], {}

    results = []
    importance_accum: dict[str, float] = {f: 0.0 for f in feature_names}

    for gen, train_end in enumerate(range(min_train, len(X) - embargo - test_window, step)):
        test_start = train_end + embargo
        test_end = test_start + test_window

        if test_end > len(X):
            break

        # Split train into train + validation for early stopping
        val_size = max(int(train_end * VAL_FRACTION), SNAPSHOTS_PER_DAY)
        val_start = train_end - val_size

        X_train, y_train = X[:val_start], y[:val_start]
        X_val, y_val = X[val_start:train_end], y[val_start:train_end]
        X_test, y_test = X[test_start:test_end], y[test_start:test_end]

        # Per-fold target clipping (regression only — prevents future percentile leakage)
        if not is_binary:
            p1, p99 = np.percentile(y_train, [1, 99])
            y_train = np.clip(y_train, p1, p99)
            y_val = np.clip(y_val, p1, p99)
            # DO NOT clip y_test — evaluate on raw values

        dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=feature_names)
        dval = xgb.DMatrix(X_val, label=y_val, feature_names=feature_names)
        dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_names)

        # Early stopping uses VALIDATION set, NOT test set
        model = xgb.train(
            params,
            dtrain,
            num_boost_round=NUM_BOOST_ROUNDS,
            evals=[(dval, "val")],
            early_stopping_rounds=EARLY_STOPPING_ROUNDS,
            verbose_eval=False,
        )

        # Predict on the UNTOUCHED test set
        y_pred = model.predict(dtest)

        # Metrics — Spearman with p-value
        sp, sp_pval = spearmanr(y_test, y_pred)
        if np.isnan(sp):
            sp = 0.0
            sp_pval = 1.0
        mae = float(np.mean(np.abs(y_test - y_pred)))
        centered_dir = 100 * float(np.mean(
            np.sign(y_test - np.mean(y_test)) == np.sign(y_pred - np.mean(y_pred))
        ))

        rounds_used = model.best_iteration + 1 if hasattr(model, "best_iteration") else NUM_BOOST_ROUNDS

        # Binary metrics
        binary_metrics: dict = {}
        if is_binary:
            binary_metrics = _compute_binary_metrics(y_test, y_pred)

        results.append(ExperimentResult(
            generation=gen,
            spearman=round(sp, 4),
            spearman_pval=round(float(sp_pval), 6),
            mae=round(mae, 4),
            centered_dir=round(centered_dir, 1),
            rounds=rounds_used,
            train_size=len(X_train),
            val_size=len(X_val),
            test_size=len(X_test),
            auc_roc=binary_metrics.get("auc_roc"),
            brier_score=binary_metrics.get("brier_score"),
            precision_at_50=binary_metrics.get("precision_at_50"),
        ))

        # Accumulate feature importance
        imp = model.get_score(importance_type="gain")
        for fname, gain in imp.items():
            if fname in importance_accum:
                importance_accum[fname] += gain

        extra = ""
        if is_binary and binary_metrics.get("auc_roc") is not None:
            extra = f"  auc={binary_metrics['auc_roc']:.4f}  brier={binary_metrics.get('brier_score', 0):.4f}"

        log.info(
            "  Gen %d: sp=%.4f (p=%.4f)  mae=%.4f  dir=%.1f%%%s  rounds=%d  (train=%d, val=%d, test=%d)",
            gen, sp, sp_pval, mae, centered_dir, extra,
            rounds_used, len(X_train), len(X_val), len(X_test),
        )

    # Normalize importance
    n_gens = len(results)
    if n_gens > 0:
        for f in importance_accum:
            importance_accum[f] = round(importance_accum[f] / n_gens, 4)

    return results, importance_accum


def run_permutation_baseline(
    X: np.ndarray,
    y: np.ndarray,
    feature_names: list[str],
    params: dict,
    experiment_name: str,
    is_binary: bool = False,
    n_runs: int = PERMUTATION_RUNS,
) -> float:
    """Run walk-forward on shuffled targets to establish null Spearman.

    This answers: "what Spearman do we get from pure noise on this dataset?"
    Autocorrelated time series can produce non-zero Spearman even with random
    targets because features have temporal structure. The permutation baseline
    captures this so we can compute lift above noise.

    We shuffle y globally (breaking time structure) and run 1 walk-forward
    generation per permutation run for speed. Returns mean Spearman across runs.
    """
    log.info("Running %d permutation baseline runs...", n_runs)
    rng = np.random.RandomState(42)
    spearmans = []

    min_train = MIN_TRAIN_DAYS * SNAPSHOTS_PER_DAY
    test_window = TEST_DAYS * SNAPSHOTS_PER_DAY

    # Use just the first fold for speed
    train_end = min_train
    val_size = max(int(train_end * VAL_FRACTION), SNAPSHOTS_PER_DAY)
    val_start = train_end - val_size
    test_start = train_end + EMBARGO_SNAPSHOTS
    test_end = test_start + test_window

    if test_end > len(X):
        return 0.0

    X_train = X[:val_start]
    X_val = X[val_start:train_end]
    X_test = X[test_start:test_end]

    for run in range(n_runs):
        # Shuffle target (break temporal structure)
        y_shuffled = y.copy()
        rng.shuffle(y_shuffled)

        y_train_s = y_shuffled[:val_start]
        y_val_s = y_shuffled[val_start:train_end]
        y_test_s = y_shuffled[test_start:test_end]

        if not is_binary:
            p1, p99 = np.percentile(y_train_s, [1, 99])
            y_train_s = np.clip(y_train_s, p1, p99)
            y_val_s = np.clip(y_val_s, p1, p99)

        dtrain = xgb.DMatrix(X_train, label=y_train_s, feature_names=feature_names)
        dval = xgb.DMatrix(X_val, label=y_val_s, feature_names=feature_names)
        dtest = xgb.DMatrix(X_test, label=y_test_s, feature_names=feature_names)

        model = xgb.train(
            params, dtrain,
            num_boost_round=NUM_BOOST_ROUNDS,
            evals=[(dval, "val")],
            early_stopping_rounds=EARLY_STOPPING_ROUNDS,
            verbose_eval=False,
        )

        y_pred = model.predict(dtest)
        sp, _ = spearmanr(y_test_s, y_pred)
        if np.isnan(sp):
            sp = 0.0
        spearmans.append(sp)

    baseline = float(np.mean(spearmans))
    log.info("  Permutation baseline: %.4f (runs: %s)", baseline, [round(s, 4) for s in spearmans])
    return baseline


def summarize(
    name: str,
    description: str,
    feature_names: list[str],
    total_samples: int,
    results: list[ExperimentResult],
    importance: dict[str, float],
    baseline_spearman: float = 0.0,
) -> ExperimentSummary:
    """Build summary from walk-forward results."""
    if not results:
        return ExperimentSummary(
            name=name, description=description,
            feature_count=len(feature_names),
            avg_spearman=0.0, avg_mae=0.0, avg_centered_dir=50.0,
            spearman_std=0.0,
            generations=0, total_samples=total_samples,
            results=[], verdict="FAIL",
            feature_importance={},
            baseline_spearman=baseline_spearman,
        )

    spearmans = [r.spearman for r in results]
    avg_sp = float(np.mean(spearmans))
    std_sp = float(np.std(spearmans))
    avg_mae = float(np.mean([r.mae for r in results]))
    avg_dir = float(np.mean([r.centered_dir for r in results]))
    significant = sum(1 for r in results if r.spearman_pval < 0.05)
    lift = avg_sp - baseline_spearman

    # Verdict considers:
    # 1. Absolute Spearman
    # 2. Lift above permutation baseline (must be > 0.10 to rule out noise)
    # 3. Significance (majority of generations must have p < 0.05)
    # 4. Stability (std should not exceed mean)
    if avg_sp >= 0.25 and lift >= 0.10 and significant > len(results) // 2:
        verdict = "PASS"
    elif avg_sp >= 0.15 and lift >= 0.05:
        verdict = "MARGINAL"
    else:
        verdict = "FAIL"

    # Stability warning overrides PASS → MARGINAL
    if verdict == "PASS" and std_sp > abs(avg_sp):
        verdict = "MARGINAL"
        log.warning("Downgraded to MARGINAL: Spearman std (%.4f) > mean (%.4f) — unstable", std_sp, avg_sp)

    return ExperimentSummary(
        name=name, description=description,
        feature_count=len(feature_names),
        avg_spearman=round(avg_sp, 4),
        avg_mae=round(avg_mae, 4),
        avg_centered_dir=round(avg_dir, 1),
        spearman_std=round(std_sp, 4),
        generations=len(results),
        total_samples=total_samples,
        results=results, verdict=verdict,
        feature_importance=importance,
        baseline_spearman=round(baseline_spearman, 4),
        lift_over_baseline=round(lift, 4),
        significant_generations=significant,
    )


def print_report(summary: ExperimentSummary) -> None:
    """Print a formatted experiment report to stdout."""
    print("\n" + "=" * 70)
    print(f"EXPERIMENT: {summary.name}")
    print(f"  {summary.description}")
    print(f"  Features: {summary.feature_count}  |  Samples: {summary.total_samples:,}  |  Generations: {summary.generations}")
    print(f"  Embargo gap: {EMBARGO_SNAPSHOTS} snapshots ({EMBARGO_SNAPSHOTS * 5}min)")
    print("=" * 70)

    if not summary.results:
        print("  NO RESULTS — insufficient data")
        return

    # Check if any gen has binary metrics
    has_binary = any(r.auc_roc is not None for r in summary.results)

    if has_binary:
        print(f"\n  {'Gen':>4} {'Spearman':>10} {'p-val':>8} {'AUC':>7} {'Brier':>7} {'Dir%':>7} {'Rounds':>7} {'Train':>7} {'Val':>5} {'Test':>7}")
        print("  " + "-" * 79)
        for r in summary.results:
            auc_str = f"{r.auc_roc:.4f}" if r.auc_roc is not None else "  N/A"
            brier_str = f"{r.brier_score:.4f}" if r.brier_score is not None else "  N/A"
            sig = "*" if r.spearman_pval < 0.05 else " "
            print(
                f"  {r.generation:>4} {r.spearman:>+10.4f} {r.spearman_pval:>8.4f}{sig}"
                f"{auc_str:>7} {brier_str:>7} {r.centered_dir:>6.1f}%"
                f" {r.rounds:>7} {r.train_size:>7} {r.val_size:>5} {r.test_size:>7}"
            )
    else:
        print(f"\n  {'Gen':>4} {'Spearman':>10} {'p-val':>8} {'MAE':>8} {'Dir%':>7} {'Rounds':>7} {'Train':>7} {'Val':>5} {'Test':>7}")
        print("  " + "-" * 73)
        for r in summary.results:
            sig = "*" if r.spearman_pval < 0.05 else " "
            print(
                f"  {r.generation:>4} {r.spearman:>+10.4f} {r.spearman_pval:>8.4f}{sig}"
                f" {r.mae:>8.4f} {r.centered_dir:>6.1f}%"
                f" {r.rounds:>7} {r.train_size:>7} {r.val_size:>5} {r.test_size:>7}"
            )

    print(f"\n  (* = p < 0.05, statistically significant)")

    print(f"\n  AVERAGE: spearman={summary.avg_spearman:+.4f} +/- {summary.spearman_std:.4f}  mae={summary.avg_mae:.4f}  dir={summary.avg_centered_dir:.1f}%")
    print(f"  BASELINE (permutation): {summary.baseline_spearman:+.4f}")
    print(f"  LIFT over baseline:     {summary.lift_over_baseline:+.4f}")
    print(f"  Significant gens:       {summary.significant_generations}/{summary.generations} (p < 0.05)")

    # Feature importance (top 5)
    if summary.feature_importance:
        sorted_imp = sorted(summary.feature_importance.items(), key=lambda x: -x[1])[:5]
        print("\n  Top features:")
        for fname, gain in sorted_imp:
            print(f"    {fname:<30} gain={gain:.2f}")

    # Verdict
    verdict_color = {"PASS": "+++", "MARGINAL": "~~~", "FAIL": "---"}
    print(f"\n  [{verdict_color[summary.verdict]}] VERDICT: {summary.verdict}")
    if summary.verdict == "PASS":
        print("  → Signal confirmed. Lift above noise, statistically significant, stable.")
    elif summary.verdict == "MARGINAL":
        print("  → Weak signal or unstable. Needs feature engineering or more data.")
    else:
        print("  → No real signal above noise. Discard.")
    print("=" * 70)


def save_report(summary: ExperimentSummary, output_dir: str = "satellite/experiments/results") -> None:
    """Save experiment results to JSON."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    path = Path(output_dir) / f"{summary.name}.json"
    data = {
        "name": summary.name,
        "description": summary.description,
        "feature_count": summary.feature_count,
        "avg_spearman": summary.avg_spearman,
        "spearman_std": summary.spearman_std,
        "avg_mae": summary.avg_mae,
        "avg_centered_dir": summary.avg_centered_dir,
        "generations": summary.generations,
        "total_samples": summary.total_samples,
        "verdict": summary.verdict,
        "baseline_spearman": summary.baseline_spearman,
        "lift_over_baseline": summary.lift_over_baseline,
        "significant_generations": summary.significant_generations,
        "feature_importance": summary.feature_importance,
        "embargo_snapshots": EMBARGO_SNAPSHOTS,
        "val_fraction": VAL_FRACTION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "per_generation": [
            {
                "gen": r.generation, "spearman": r.spearman,
                "spearman_pval": r.spearman_pval,
                "mae": r.mae, "centered_dir": r.centered_dir,
                "rounds": r.rounds, "train_size": r.train_size,
                "val_size": r.val_size, "test_size": r.test_size,
                "auc_roc": r.auc_roc, "brier_score": r.brier_score,
                "precision_at_50": r.precision_at_50,
            }
            for r in summary.results
        ],
    }
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    log.info("Results saved to %s", path)


def enrich_snapshots(rows: list[dict], coin: str, data_db_path: str) -> list[dict]:
    """Enrich snapshot rows with v3+v4 features from data-layer DB.

    Delegates to train_conditions.enrich_with_new_features which computes
    all 14 derived features (v3: liq_total, funding_rate_raw, oi_change_rate,
    price_trend_4h, volume_acceleration, cvd_ratio_1h, realized_vol_4h,
    vol_of_vol; v4: return_autocorrelation, body_ratio_1h, upper_wick_ratio_1h,
    funding_velocity, hour_sin, hour_cos).
    """
    from satellite.training.train_conditions import enrich_with_new_features
    return enrich_with_new_features(rows, coin, data_db_path)


def get_standard_args():
    """Create standard argparse for experiments."""
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="storage/satellite.db", help="Path to satellite.db")
    parser.add_argument("--coin", default="BTC", help="Coin to train on")
    parser.add_argument("--data-db", default=None, help="Path to data-layer DB for v3+v4 feature enrichment")
    parser.add_argument("--no-baseline", action="store_true", help="Skip permutation baseline (faster)")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser
