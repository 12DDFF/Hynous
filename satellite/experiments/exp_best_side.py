"""Experiment: Best Side 30m

Predicts: Is LONG the better side in the next 30 minutes?
Features: Directional-heavy subset (CVD, OI direction, funding, liq imbalance).
Label: Binary — 1 if best_long_roe_30m_gross > best_short_roe_30m_gross, else 0.

Why it might work: We predict magnitude well (vol, range, MAE models all pass)
but never direction. This reframes direction as a COMPARISON — which side gets
the bigger move — rather than predicting ROE values. CVD imbalance, OI direction,
funding bias, liq imbalance all carry directional information.

Even 53-55% accuracy = massive edge because it directly drives entry side.

Statistical notes:
  - Dead zone: exclude rows where abs(long_roe - short_roe) < 0.1% — these
    are coin-flip situations where the model can't learn anything useful.
  - 48-snapshot embargo.
  - Class balance should be near 50/50 (market has no persistent long bias).

Usage:
    python -m satellite.experiments.exp_best_side --db storage/satellite.db
"""

import logging
import sys

import numpy as np

from satellite.experiments.harness import (
    load_snapshots_with_labels,
    enrich_snapshots,
    run_walkforward,
    run_permutation_baseline,
    summarize,
    print_report,
    save_report,
    get_standard_args,
    XGBOOST_BINARY,
)

log = logging.getLogger(__name__)

EXPERIMENT_NAME = "best_side_30m"
DESCRIPTION = "Predict whether LONG outperforms SHORT in 30m (binary)"

# Minimum ROE difference to include (avoid coin-flip noise)
MIN_ROE_DIFF = 0.1

FEATURES = [
    "cvd_ratio_30m",
    "cvd_ratio_1h",
    "cvd_acceleration",
    "price_trend_1h",
    "price_trend_4h",
    "oi_price_direction",
    "oi_change_rate_1h",
    "liq_imbalance_1h",
    "funding_vs_30d_zscore",
    "funding_rate_raw",
    "funding_velocity",
    "close_position_5m",
    "return_autocorrelation",
    "body_ratio_1h",
    "upper_wick_ratio_1h",
    "volume_acceleration",
    "hour_sin",
    "hour_cos",
]


def build_targets(rows: list[dict]) -> list[dict]:
    for row in rows:
        long_roe = row.get("best_long_roe_30m_gross")
        short_roe = row.get("best_short_roe_30m_gross")

        if long_roe is None or short_roe is None:
            row["target_best_side"] = None
            continue

        # Dead zone: skip near-ties
        if abs(long_roe - short_roe) < MIN_ROE_DIFF:
            row["target_best_side"] = None
            continue

        row["target_best_side"] = 1 if long_roe > short_roe else 0

    long_wins = sum(1 for r in rows if r.get("target_best_side") == 1)
    total = sum(1 for r in rows if r.get("target_best_side") is not None)
    excluded = sum(1 for r in rows if r.get("target_best_side") is None
                   and r.get("best_long_roe_30m_gross") is not None)
    if total > 0:
        log.info("Long wins: %d / %d = %.1f%% (excluded %d dead-zone rows)",
                 long_wins, total, 100 * long_wins / total, excluded)

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

    if args.data_db:
        rows = enrich_snapshots(rows, args.coin, args.data_db)
    else:
        log.warning("No --data-db provided. v3+v4 features will be zero/neutral.")

    rows = build_targets(rows)

    valid = [r for r in rows
             if r.get("target_best_side") is not None
             and all(r.get(f) is not None for f in FEATURES)]

    log.info("Valid rows: %d / %d", len(valid), len(rows))

    if not valid:
        log.error("No valid rows")
        sys.exit(1)

    X = np.array([[row[f] for f in FEATURES] for row in valid], dtype=np.float32)
    y = np.array([row["target_best_side"] for row in valid], dtype=np.float32)

    log.info("Class balance: %.1f%% long wins", y.mean() * 100)

    baseline = 0.0
    if not args.no_baseline:
        baseline = run_permutation_baseline(
            X, y, FEATURES, XGBOOST_BINARY, EXPERIMENT_NAME, is_binary=True,
        )

    results, importance = run_walkforward(
        X, y, FEATURES, XGBOOST_BINARY, EXPERIMENT_NAME, is_binary=True,
    )

    summary = summarize(EXPERIMENT_NAME, DESCRIPTION, FEATURES,
                        len(valid), results, importance, baseline)
    print_report(summary)
    save_report(summary)


if __name__ == "__main__":
    main()
