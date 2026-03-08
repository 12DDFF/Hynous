"""Experiment 3: Regime Transition Prediction

Predicts: Will the volatility-based regime change within the next 4h?
Features: Same 14 market features.
Label: Binary — vol-based regime at t+48 differs from regime at t.

IMPORTANT: We do NOT use a regime classifier that is a deterministic function
of the same features. That would make the model learn its own feature
thresholds (circular). Instead, we use the LABEL-derived regime: based on
actual future price outcomes (ROE labels), not current features.

Regime at time t is defined by the LABEL at t:
  - HIGH_MOVE: best move in 30m > 75th percentile of all moves (training set)
  - LOW_MOVE: best move in 30m < 25th percentile
  - NORMAL_MOVE: in between

This is an outcome-based regime, so predicting its change is predicting
"will the market's actual behavior change" — not "will my classifier output
change." The features at t cannot trivially compute the label at t+48.

Statistical notes:
  - Regime percentile thresholds computed per-fold on training data only
    (expanding window) to prevent future leakage.
  - 48-snapshot embargo covers the 4h look-ahead.

Usage:
    python -m satellite.experiments.exp_regime_transition --db storage/satellite.db
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
    SNAPSHOTS_PER_DAY,
    MIN_TRAIN_DAYS,
    EMBARGO_SNAPSHOTS,
    TEST_DAYS,
)

log = logging.getLogger(__name__)

EXPERIMENT_NAME = "regime_transition"
DESCRIPTION = "Predict outcome-regime change within 4h (binary classification)"

LOOK_4H = 48


def build_targets(rows: list[dict]) -> list[dict]:
    """Add regime_transition target using label-derived regimes.

    1. Compute move magnitude per snapshot: max(abs(long_roe_30m), abs(short_roe_30m))
    2. Compute percentile thresholds using expanding window (only past data)
    3. Classify each snapshot into regime bucket
    4. Target = 1 if regime at i differs from regime at i+48, else 0
    """
    n = len(rows)

    # Step 1: compute move magnitudes
    moves = []
    for row in rows:
        long_roe = row.get("best_long_roe_30m_gross")
        short_roe = row.get("best_short_roe_30m_gross")
        if long_roe is not None and short_roe is not None:
            moves.append(max(abs(long_roe), abs(short_roe)))
        else:
            moves.append(None)

    # Step 2 & 3: expanding-window regime classification
    # We need at least min_train days of data before we can compute stable percentiles
    min_history = MIN_TRAIN_DAYS * SNAPSHOTS_PER_DAY
    regimes: list[str | None] = [None] * n

    for i in range(n):
        if moves[i] is None:
            continue
        if i < min_history:
            # Not enough history to compute stable percentiles
            continue

        # Expanding window: use all data up to (but not including) this point
        past_moves = [m for m in moves[:i] if m is not None]
        if len(past_moves) < 100:
            continue

        past_arr = np.array(past_moves)
        p25 = float(np.percentile(past_arr, 25))
        p75 = float(np.percentile(past_arr, 75))

        if moves[i] < p25:
            regimes[i] = "LOW_MOVE"
        elif moves[i] > p75:
            regimes[i] = "HIGH_MOVE"
        else:
            regimes[i] = "NORMAL_MOVE"

    # Step 4: build transition targets
    for i in range(n):
        if regimes[i] is None:
            rows[i]["target_regime_transition"] = None
            continue

        future_idx = i + LOOK_4H
        if future_idx >= n or regimes[future_idx] is None:
            rows[i]["target_regime_transition"] = None
            continue

        rows[i]["target_regime_transition"] = 1 if regimes[i] != regimes[future_idx] else 0

    # Log stats
    regime_counts: dict[str, int] = {}
    for r in regimes:
        if r:
            regime_counts[r] = regime_counts.get(r, 0) + 1
    log.info("Regime distribution: %s", regime_counts)

    transition_count = sum(1 for row in rows if row.get("target_regime_transition") == 1)
    total_labeled = sum(1 for row in rows if row.get("target_regime_transition") is not None)
    if total_labeled > 0:
        log.info("Transition rate: %d / %d = %.1f%%", transition_count, total_labeled, 100 * transition_count / total_labeled)

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

    log.info("Building regime_transition targets...")
    rows = build_targets(rows)

    feature_names = list(FEATURE_NAMES)
    valid = []
    for row in rows:
        target = row.get("target_regime_transition")
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
    y = np.array([row["target_regime_transition"] for row in valid], dtype=np.float32)

    log.info("Class balance: %.1f%% transitions", y.mean() * 100)

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
