"""Experiment: Exit Timing

Predicts: Has the long-side move peaked? Should you exit NOW?
Features: Market structure + momentum signals.
Label: Binary — 1 if the best remaining long ROE from i to i+6 is LESS than
       the ROE already captured (i.e., the move has peaked, holding loses value).

This is different from exp_exit_model which uses simulated_exits data.
This experiment works purely from snapshot labels and answers a simpler
question: "has the best of the move already happened?"

Why it should work: Move exhaustion is signaled by:
  - Waning CVD (acceleration turns negative)
  - Upper wicks increasing (sellers at highs)
  - Volume declining (volume_acceleration < 1)
  - OI starting to drop (profit-taking)
  - Return autocorrelation going negative (mean reversion starting)

Complementary to trend_continuation — that predicts "will it continue?",
this predicts "has it peaked?"

Statistical notes:
  - Only evaluates rows where current long ROE is positive (>0.1%).
    No point asking "should you exit?" when you're not in profit.
  - Target uses label comparison: best_long_roe_30m at current snapshot
    vs best_long_roe_30m at i+6. If future is worse, move has peaked.
  - 48-snapshot embargo.

Usage:
    python -m satellite.experiments.exp_exit_timing --db storage/satellite.db
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

EXPERIMENT_NAME = "exit_timing"
DESCRIPTION = "Predict whether long-side move has peaked (binary)"

LOOK_30M = 6
MIN_PROFIT = 0.1  # Only evaluate when current ROE > 0.1%

FEATURES = [
    "return_autocorrelation",
    "body_ratio_1h",
    "upper_wick_ratio_1h",
    "close_position_5m",
    "cvd_ratio_30m",
    "cvd_acceleration",
    "volume_acceleration",
    "volume_vs_1h_avg_ratio",
    "realized_vol_1h",
    "vol_of_vol",
    "oi_change_rate_1h",
    "price_trend_1h",
    "price_trend_4h",
    "liq_imbalance_1h",
    "funding_vs_30d_zscore",
    "hour_sin",
    "hour_cos",
]


def build_targets(rows: list[dict]) -> list[dict]:
    """Add exit_timing target.

    For each snapshot i where long ROE is positive:
    - Look at best_long_roe_30m_gross at i+6 (30m later)
    - If future ROE < current ROE, the move has peaked → target = 1 (exit)
    - If future ROE >= current ROE, still running → target = 0 (hold)
    """
    n = len(rows)

    for i, row in enumerate(rows):
        current_roe = row.get("best_long_roe_30m_gross")

        if current_roe is None or current_roe < MIN_PROFIT:
            row["target_exit_timing"] = None
            continue

        future_idx = i + LOOK_30M
        if future_idx >= n:
            row["target_exit_timing"] = None
            continue

        future_roe = rows[future_idx].get("best_long_roe_30m_gross")
        if future_roe is None:
            row["target_exit_timing"] = None
            continue

        # Move has peaked if future ROE is lower
        row["target_exit_timing"] = 1 if future_roe < current_roe else 0

    peaked = sum(1 for r in rows if r.get("target_exit_timing") == 1)
    total = sum(1 for r in rows if r.get("target_exit_timing") is not None)
    excluded = len(rows) - total
    if total > 0:
        log.info("Peaked rate: %d / %d = %.1f%% (excluded %d non-profit rows)",
                 peaked, total, 100 * peaked / total, excluded)

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
             if r.get("target_exit_timing") is not None
             and all(r.get(f) is not None for f in FEATURES)]

    log.info("Valid rows: %d / %d", len(valid), len(rows))

    if not valid:
        log.error("No valid rows")
        sys.exit(1)

    X = np.array([[row[f] for f in FEATURES] for row in valid], dtype=np.float32)
    y = np.array([row["target_exit_timing"] for row in valid], dtype=np.float32)

    log.info("Class balance: %.1f%% peaked (exit)", y.mean() * 100)

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
