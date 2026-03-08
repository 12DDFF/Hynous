"""Experiment 2: Stop Loss Survival Probability

Predicts: Probability that a stop loss at X% distance gets hit within 30m.
Features: Same 14 market features.
Labels: Binary — did MAE exceed the SL threshold within the 30m window?

We train 4 sub-models (one per SL distance: 0.3%, 0.5%, 1.0%, 2.0%).
Each is a binary classification task.

Why it should work: MAE models already achieve Spearman 0.3+ predicting
maximum adverse excursion. This converts that into actionable "your SL
at 0.5% has an 80% chance of surviving" — directly useful for the agent.

Statistical notes:
  - Uses LONG-side MAE for long SL and SHORT-side MAE for short SL
    (not conflating both sides).
  - MAE is computed over 30m window (matches our label window exactly).
  - Separate sub-experiments per SL distance — not one multi-output model.
  - Class balance is logged and must be 10-90% for meaningful results.

Usage:
    python -m satellite.experiments.exp_stop_survival --db storage/satellite.db
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
)

log = logging.getLogger(__name__)

EXPERIMENT_NAME = "stop_survival"
DESCRIPTION = "Predict probability of SL hit at various distances (binary per distance)"

# SL distances in price % (we convert to ROE at 20x for threshold comparison)
SL_DISTANCES_PCT = [0.3, 0.5, 1.0, 2.0]
LEVERAGE = 20


def build_targets(rows: list[dict]) -> list[dict]:
    """Add stop_survival targets per side: did MAE exceed SL within 30m?

    Uses worst_long_mae_30m for long-side SL survival.
    Uses worst_short_mae_30m for short-side SL survival.

    We predict LONG-side survival (the model learns "in current conditions,
    will a long position's drawdown exceed X%?"). Short-side is symmetric
    and can be tested separately if long shows signal.

    MAE is negative (it's a drawdown), so abs(mae) is the magnitude.
    SL threshold in ROE terms = sl_price_pct * leverage.
    """
    for row in rows:
        mae_long = row.get("worst_long_mae_30m")

        for sl_pct in SL_DISTANCES_PCT:
            sl_roe = sl_pct * LEVERAGE  # e.g., 0.3% * 20 = 6% ROE
            col = f"target_sl_hit_{str(sl_pct).replace('.', '_')}"

            if mae_long is not None:
                # Long-side only: did the long MAE exceed the SL?
                rows[rows.index(row)][col] = 1 if abs(mae_long) >= sl_roe else 0
            else:
                row[col] = None

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

    log.info("Building stop_survival targets...")
    rows = build_targets(rows)

    feature_names = list(FEATURE_NAMES)

    # Run a sub-experiment for each SL distance
    for sl_pct in SL_DISTANCES_PCT:
        col = f"target_sl_hit_{str(sl_pct).replace('.', '_')}"
        sub_name = f"stop_survival_{sl_pct}pct"

        valid = []
        for row in rows:
            target = row.get(col)
            if target is None:
                continue
            if any(row.get(f) is None for f in feature_names):
                continue
            valid.append(row)

        log.info("\n%s: %d valid rows", sub_name, len(valid))

        if not valid:
            continue

        X = np.array([[row[f] for f in feature_names] for row in valid], dtype=np.float32)
        y = np.array([row[col] for row in valid], dtype=np.float32)

        hit_rate = y.mean() * 100
        log.info("  SL hit rate at %.1f%%: %.1f%% (class balance)", sl_pct, hit_rate)

        # Skip if class balance is too extreme (< 5% or > 95%)
        if hit_rate < 5 or hit_rate > 95:
            log.warning("  Skipping %s — class balance too extreme (%.1f%%)", sub_name, hit_rate)
            continue

        # Permutation baseline
        baseline = 0.0
        if not args.no_baseline:
            baseline = run_permutation_baseline(
                X, y, feature_names, XGBOOST_BINARY, sub_name, is_binary=True,
            )

        results, importance = run_walkforward(
            X, y, feature_names, XGBOOST_BINARY, sub_name, is_binary=True,
        )

        summary = summarize(
            sub_name,
            f"Predict long-side SL hit probability at {sl_pct}% price distance (binary)",
            feature_names, len(valid), results, importance, baseline,
        )
        print_report(summary)
        save_report(summary)


if __name__ == "__main__":
    main()
