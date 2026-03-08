"""Experiment: Asymmetric Risk

Predicts: Is long-side risk higher than short-side risk?
Features: Full structural + directional feature set.
Label: Binary — 1 if abs(worst_long_mae_30m) > abs(worst_short_mae_30m).

This is NOT about which side profits more (that's best_side_30m).
This is about which side BLEEDS more — completely different signal.
A market can have higher long PROFIT but also higher long RISK.

Why it should work: Risk asymmetry is driven by:
  - Liq imbalance (more longs liquidated = long risk higher)
  - OI direction (OI up + price up = longs overextended)
  - Funding (high funding = long-crowded, risk of squeeze → long risk)
  - CVD (strong buying → shorts squeezed out → less short risk)

This is potentially MORE stable than direction prediction because
MAE is less noisy than ROE (MAE is the worst point, ROE is the best —
worst points are bounded by liquidation mechanics).

Statistical notes:
  - Dead zone: exclude rows where risk difference < 0.5% ROE.
  - 48-snapshot embargo.

Usage:
    python -m satellite.experiments.exp_asymmetric_risk --db storage/satellite.db
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

EXPERIMENT_NAME = "asymmetric_risk"
DESCRIPTION = "Predict whether long-side drawdown exceeds short-side drawdown (binary)"

MIN_RISK_DIFF = 0.5  # Minimum MAE difference to include (% ROE)

FEATURES = [
    "cvd_ratio_30m",
    "cvd_ratio_1h",
    "cvd_acceleration",
    "price_trend_1h",
    "price_trend_4h",
    "oi_price_direction",
    "oi_change_rate_1h",
    "oi_vs_7d_avg_ratio",
    "oi_funding_pressure",
    "liq_imbalance_1h",
    "liq_total_1h_usd",
    "funding_vs_30d_zscore",
    "funding_rate_raw",
    "funding_velocity",
    "realized_vol_1h",
    "volume_acceleration",
    "body_ratio_1h",
    "upper_wick_ratio_1h",
    "return_autocorrelation",
    "close_position_5m",
]


def build_targets(rows: list[dict]) -> list[dict]:
    for row in rows:
        mae_long = row.get("worst_long_mae_30m")
        mae_short = row.get("worst_short_mae_30m")

        if mae_long is None or mae_short is None:
            row["target_asym_risk"] = None
            continue

        long_risk = abs(mae_long)
        short_risk = abs(mae_short)

        # Dead zone: skip when risk is nearly equal
        if abs(long_risk - short_risk) < MIN_RISK_DIFF:
            row["target_asym_risk"] = None
            continue

        # 1 = long side has higher risk (more drawdown)
        row["target_asym_risk"] = 1 if long_risk > short_risk else 0

    long_riskier = sum(1 for r in rows if r.get("target_asym_risk") == 1)
    total = sum(1 for r in rows if r.get("target_asym_risk") is not None)
    excluded = sum(1 for r in rows if r.get("target_asym_risk") is None
                   and r.get("worst_long_mae_30m") is not None)
    if total > 0:
        log.info("Long riskier: %d / %d = %.1f%% (excluded %d dead-zone rows)",
                 long_riskier, total, 100 * long_riskier / total, excluded)

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
             if r.get("target_asym_risk") is not None
             and all(r.get(f) is not None for f in FEATURES)]

    log.info("Valid rows: %d / %d", len(valid), len(rows))

    if not valid:
        log.error("No valid rows")
        sys.exit(1)

    X = np.array([[row[f] for f in FEATURES] for row in valid], dtype=np.float32)
    y = np.array([row["target_asym_risk"] for row in valid], dtype=np.float32)

    log.info("Class balance: %.1f%% long-riskier", y.mean() * 100)

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
