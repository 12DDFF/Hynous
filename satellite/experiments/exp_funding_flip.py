"""Experiment 5: Funding Rate Flip Prediction

Predicts: Will funding rate flip sign within 4h?
Features: Same 14 market features.
Label: Binary — funding sign at t+48 differs from sign at t.

Why it should work: funding_4h condition already achieves Spearman ~0.3
predicting funding z-score change. This converts it to an actionable
binary signal.

Statistical notes:
  - Dead zone rows (where funding is near zero) are EXCLUDED entirely
    rather than labeled as 0. Near-zero funding doesn't have a meaningful
    "sign" so including them adds noise and inflates the no-flip class.
  - Expanding-window sign threshold: the dead zone boundary is based on
    the standard deviation of funding in the training window, not a
    fixed constant. This adapts to different funding regimes.
  - 48-snapshot embargo covers the 4h look-ahead.

Usage:
    python -m satellite.experiments.exp_funding_flip --db storage/satellite.db
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

EXPERIMENT_NAME = "funding_flip"
DESCRIPTION = "Predict funding rate sign flip within 4h (binary)"

LOOK_4H = 48
# Dead zone: exclude snapshots where |funding_zscore| < this fraction of std
DEAD_ZONE_FRACTION = 0.25


def build_targets(rows: list[dict]) -> list[dict]:
    """Add funding_flip target with adaptive dead zone.

    1. Compute expanding-window std of funding_vs_30d_zscore.
    2. Dead zone = DEAD_ZONE_FRACTION * expanding_std.
    3. Exclude snapshots in dead zone entirely (target = None).
    4. For remaining: target = 1 if funding sign flips by t+48, else 0.
    """
    n = len(rows)
    min_history = MIN_TRAIN_DAYS * SNAPSHOTS_PER_DAY

    for i in range(n):
        current = rows[i].get("funding_vs_30d_zscore")
        if current is None:
            rows[i]["target_funding_flip"] = None
            continue

        if i < min_history:
            rows[i]["target_funding_flip"] = None
            continue

        future_idx = i + LOOK_4H
        if future_idx >= n:
            rows[i]["target_funding_flip"] = None
            continue

        future = rows[future_idx].get("funding_vs_30d_zscore")
        if future is None:
            rows[i]["target_funding_flip"] = None
            continue

        # Expanding-window std for dead zone threshold
        past_funding = [
            rows[j].get("funding_vs_30d_zscore")
            for j in range(max(0, i - 5000), i)  # cap lookback for speed
            if rows[j].get("funding_vs_30d_zscore") is not None
        ]
        if len(past_funding) < 50:
            rows[i]["target_funding_flip"] = None
            continue

        funding_std = float(np.std(past_funding))
        dead_zone = DEAD_ZONE_FRACTION * max(funding_std, 0.1)

        # Exclude if either current or future is in dead zone
        if abs(current) < dead_zone or abs(future) < dead_zone:
            rows[i]["target_funding_flip"] = None
            continue

        current_sign = 1 if current > 0 else -1
        future_sign = 1 if future > 0 else -1

        rows[i]["target_funding_flip"] = 1 if current_sign != future_sign else 0

    flip_count = sum(1 for r in rows if r.get("target_funding_flip") == 1)
    total = sum(1 for r in rows if r.get("target_funding_flip") is not None)
    excluded = sum(1 for r in rows if r.get("target_funding_flip") is None and r.get("funding_vs_30d_zscore") is not None)
    if total > 0:
        log.info("Funding flip rate: %d / %d = %.1f%% (excluded %d dead-zone rows)",
                 flip_count, total, 100 * flip_count / total, excluded)

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

    log.info("Building funding_flip targets...")
    rows = build_targets(rows)

    feature_names = list(FEATURE_NAMES)
    valid = []
    for row in rows:
        target = row.get("target_funding_flip")
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
    y = np.array([row["target_funding_flip"] for row in valid], dtype=np.float32)

    log.info("Class balance: %.1f%% flips", y.mean() * 100)

    if y.mean() < 0.05 or y.mean() > 0.95:
        log.warning("Class balance too extreme (%.1f%%) — results may be unreliable", y.mean() * 100)

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
