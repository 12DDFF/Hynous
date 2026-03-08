"""Experiment: Fakeout Detector

Predicts: Is the current move a fakeout that will reverse within 30m?
Features: Microstructure + flow + vol signals.
Label: Binary — 1 if a >0.3% 1h move's opposite-side 30m ROE exceeds the
       same-side ROE (reversal stronger than continuation).

Why it should work: Fakeouts are the #1 loss source for the agent. Real
breakouts have: high volume, aligned CVD, strong body ratios, rising OI.
Fakeouts have: low volume, divergent CVD, long wicks, flat OI. These are
exactly our features.

A model that flags "this breakout is likely fake" even 55% of the time
prevents the agent from entering bad trades.

Statistical notes:
  - Only evaluates rows where a >0.3% move just happened (else target = None).
  - "Reversed" means the close price at some point in [i+1, i+6] returns
    within 0.1% of the close at i-1 (pre-move level).
  - We use price_trend_1h delta as a proxy for recent move since we don't
    have raw close prices in the snapshot table.
  - 48-snapshot embargo.

Usage:
    python -m satellite.experiments.exp_fakeout --db storage/satellite.db
"""

import logging
import math
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

EXPERIMENT_NAME = "fakeout_detector"
DESCRIPTION = "Predict whether a >0.3% move reversal exceeds continuation in 30m (binary)"

LOOK_30M = 6
MOVE_THRESHOLD = 0.3   # Minimum |price_trend_1h| to trigger evaluation (%)

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
    "oi_price_direction",
    "liq_imbalance_1h",
    "price_trend_1h",
    "funding_vs_30d_zscore",
]


def build_targets(rows: list[dict]) -> list[dict]:
    """Add fakeout target.

    A fakeout is defined as:
    1. At snapshot i, price has moved >MOVE_THRESHOLD% in 1h
    2. The opposite-side 30m ROE exceeds the same-side 30m ROE
       (i.e., the reversal was stronger than the continuation)

    If price_trend_1h > 0 (bullish move), fakeout = 1 if short_roe > long_roe.
    If price_trend_1h < 0 (bearish move), fakeout = 1 if long_roe > short_roe.
    """
    for row in rows:
        trend = row.get("price_trend_1h")
        long_roe = row.get("best_long_roe_30m_gross")
        short_roe = row.get("best_short_roe_30m_gross")

        if trend is None or long_roe is None or short_roe is None:
            row["target_fakeout"] = None
            continue

        # Only evaluate when a meaningful move has occurred
        if abs(trend) < MOVE_THRESHOLD:
            row["target_fakeout"] = None
            continue

        if trend > 0:
            # Bullish move — fakeout if reversal > continuation
            row["target_fakeout"] = 1 if short_roe > long_roe else 0
        else:
            # Bearish move — fakeout if reversal > continuation
            row["target_fakeout"] = 1 if long_roe > short_roe else 0

    fakeout_count = sum(1 for r in rows if r.get("target_fakeout") == 1)
    total = sum(1 for r in rows if r.get("target_fakeout") is not None)
    excluded = len(rows) - total
    if total > 0:
        log.info("Fakeout rate: %d / %d = %.1f%% (excluded %d no-move rows)",
                 fakeout_count, total, 100 * fakeout_count / total, excluded)

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
             if r.get("target_fakeout") is not None
             and all(r.get(f) is not None for f in FEATURES)]

    log.info("Valid rows: %d / %d", len(valid), len(rows))

    if not valid:
        log.error("No valid rows")
        sys.exit(1)

    X = np.array([[row[f] for f in FEATURES] for row in valid], dtype=np.float32)
    y = np.array([row["target_fakeout"] for row in valid], dtype=np.float32)

    log.info("Class balance: %.1f%% fakeouts", y.mean() * 100)

    # Fakeout filters to ~19k rows (moves > 0.3% only), so use shorter
    # training window to allow at least a few walk-forward generations
    train_days = 45

    baseline = 0.0
    if not args.no_baseline:
        baseline = run_permutation_baseline(
            X, y, FEATURES, XGBOOST_BINARY, EXPERIMENT_NAME, is_binary=True,
            min_train_days=train_days,
        )

    results, importance = run_walkforward(
        X, y, FEATURES, XGBOOST_BINARY, EXPERIMENT_NAME, is_binary=True,
        min_train_days=train_days,
    )

    summary = summarize(EXPERIMENT_NAME, DESCRIPTION, FEATURES,
                        len(valid), results, importance, baseline)
    print_report(summary)
    save_report(summary)


if __name__ == "__main__":
    main()
