"""Experiment 6: Volatility Regime Shift Prediction

Predicts: Will volatility regime change within 4h?
Features: Same 14 market features.
Label: Binary — vol regime at t+48 differs from vol regime at t.

Vol regimes: LOW (< p25), NORMAL (p25-p75), HIGH (> p75)
based on realized_vol_1h distribution.

Why it should work: vol_1h achieves Spearman 0.76 — our strongest signal.
Vol regime shifts are what the agent needs to anticipate. This predicts
the transition. Vol expansion/compression in existing features are
direct precursors.

Statistical notes:
  - Regime percentile thresholds computed with EXPANDING WINDOW on
    training data only — not the full dataset. This prevents the
    percentile boundaries from leaking future distributional info.
  - 3 regimes (not 4) to keep class balance reasonable. With 4 regimes
    the EXTREME bucket (~10% of data) makes transitions too imbalanced.
  - 48-snapshot embargo covers the 4h look-ahead.

Usage:
    python -m satellite.experiments.exp_vol_regime_shift --db storage/satellite.db
"""

import logging
import sys

import numpy as np

from satellite.features import FEATURE_NAMES
from satellite.experiments.harness import (
    load_snapshots_with_labels,
    run_walkforward,
    run_permutation_baseline,
    summarize,
    print_report,
    save_report,
    get_standard_args,
    XGBOOST_BINARY,
    MIN_TRAIN_DAYS,
    SNAPSHOTS_PER_DAY,
)

log = logging.getLogger(__name__)

EXPERIMENT_NAME = "vol_regime_shift"
DESCRIPTION = "Predict volatility regime change within 4h (binary)"

LOOK_4H = 48


def build_targets(rows: list[dict]) -> list[dict]:
    """Add vol_regime_shift target with expanding-window percentiles.

    For each snapshot i:
    1. Compute p25, p75 of realized_vol_1h using only data[:i] (expanding window)
    2. Classify current vol into LOW/NORMAL/HIGH
    3. Classify vol at i+48 using same thresholds (from i, not from i+48)
    4. Target = 1 if regimes differ, else 0
    """
    n = len(rows)
    min_history = MIN_TRAIN_DAYS * SNAPSHOTS_PER_DAY

    # Pre-extract all vol values for efficiency
    vols = [row.get("realized_vol_1h") for row in rows]

    for i in range(n):
        if vols[i] is None:
            rows[i]["target_vol_regime_shift"] = None
            continue

        if i < min_history:
            rows[i]["target_vol_regime_shift"] = None
            continue

        future_idx = i + LOOK_4H
        if future_idx >= n or vols[future_idx] is None:
            rows[i]["target_vol_regime_shift"] = None
            continue

        # Expanding window: percentiles from all data up to (not including) i
        past_vols = [v for v in vols[:i] if v is not None]
        if len(past_vols) < 100:
            rows[i]["target_vol_regime_shift"] = None
            continue

        past_arr = np.array(past_vols)
        p25 = float(np.percentile(past_arr, 25))
        p75 = float(np.percentile(past_arr, 75))

        # Classify current and future using SAME thresholds
        def classify(vol):
            if vol < p25:
                return "LOW"
            elif vol > p75:
                return "HIGH"
            return "NORMAL"

        current_regime = classify(vols[i])
        future_regime = classify(vols[future_idx])

        rows[i]["target_vol_regime_shift"] = 1 if current_regime != future_regime else 0

    # Log stats
    shift_count = sum(1 for row in rows if row.get("target_vol_regime_shift") == 1)
    total = sum(1 for row in rows if row.get("target_vol_regime_shift") is not None)
    if total > 0:
        log.info("Vol regime shift rate: %d / %d = %.1f%%", shift_count, total, 100 * shift_count / total)

    return rows


def main():
    parser = get_standard_args()
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    log.info("Loading data for %s...", args.coin)
    rows = load_snapshots_with_labels(args.db, args.coin)
    log.info("Loaded %d labeled snapshots", len(rows))

    if not rows:
        log.error("No data found")
        sys.exit(1)

    log.info("Building vol_regime_shift targets...")
    rows = build_targets(rows)

    feature_names = list(FEATURE_NAMES)
    valid = []
    for row in rows:
        target = row.get("target_vol_regime_shift")
        if target is None:
            continue
        if any(row.get(f) is None for f in feature_names):
            continue
        valid.append(row)

    log.info("Valid rows: %d / %d", len(valid), len(rows))

    if not valid:
        log.error("No valid rows")
        sys.exit(1)

    X = np.array([[row[f] for f in feature_names] for row in valid], dtype=np.float32)
    y = np.array([row["target_vol_regime_shift"] for row in valid], dtype=np.float32)

    log.info("Class balance: %.1f%% shifts", y.mean() * 100)

    if y.mean() < 0.05 or y.mean() > 0.95:
        log.warning("Class balance too extreme (%.1f%%)", y.mean() * 100)

    # Permutation baseline
    baseline = 0.0
    if not args.no_baseline:
        baseline = run_permutation_baseline(
            X, y, feature_names, XGBOOST_BINARY, EXPERIMENT_NAME, is_binary=True,
        )

    results, importance = run_walkforward(
        X, y, feature_names, XGBOOST_BINARY, EXPERIMENT_NAME, is_binary=True,
    )

    summary = summarize(EXPERIMENT_NAME, DESCRIPTION, feature_names, len(valid), results, importance, baseline)
    print_report(summary)
    save_report(summary)


if __name__ == "__main__":
    main()
