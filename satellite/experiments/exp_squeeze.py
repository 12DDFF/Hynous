"""Experiment: Squeeze Detector

Predicts: Will a short squeeze or long squeeze happen in the next 1h?
Features: Funding + OI + liq + directional signals.
Label: Binary — 1 if price rips >1% AGAINST the funding-implied crowded side.

A squeeze happens when:
  - Funding is extreme (crowded positioning)
  - OI is high (lots of leverage)
  - Price moves against the crowd → cascading liquidations → amplified move

Short squeeze: funding positive (longs pay shorts = longs crowded? No —
positive funding means MORE longs than shorts, so shorts are the minority.
Actually: positive funding = longs pay → longs are crowded. A SHORT squeeze
happens when funding is NEGATIVE (shorts crowded) and price rips UP.

Long squeeze: funding positive (longs crowded) and price drops hard.

Operationally:
  - funding > 0 + price drops >1% in 1h → long squeeze (target = 1)
  - funding < 0 + price rises >1% in 1h → short squeeze (target = 1)
  - Otherwise → no squeeze (target = 0)

We require |funding_zscore| > 0.5 to filter out neutral-funding periods
where "squeeze" isn't meaningful.

Statistical notes:
  - Squeeze events are rare (~3-8% of rows). scale_pos_weight used.
  - Expanding-window funding threshold to avoid future leakage.
  - 48-snapshot embargo.

Usage:
    python -m satellite.experiments.exp_squeeze --db storage/satellite.db
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

EXPERIMENT_NAME = "squeeze_detector"
DESCRIPTION = "Predict squeeze event (price rips >1% against crowded side) in 1h"

LOOK_1H = 12
SQUEEZE_MOVE = 1.0      # Min price move to qualify as squeeze (%)
MIN_FUNDING_Z = 0.5     # Min |funding_zscore| to evaluate

FEATURES = [
    "funding_vs_30d_zscore",
    "funding_rate_raw",
    "funding_velocity",
    "oi_vs_7d_avg_ratio",
    "oi_change_rate_1h",
    "oi_funding_pressure",
    "liq_total_1h_usd",
    "liq_1h_vs_4h_avg",
    "liq_imbalance_1h",
    "liq_cascade_active",
    "realized_vol_1h",
    "realized_vol_4h",
    "vol_of_vol",
    "cvd_ratio_30m",
    "cvd_acceleration",
    "price_trend_1h",
    "volume_acceleration",
]

XGBOOST_BINARY_RARE = {
    **XGBOOST_BINARY,
    "scale_pos_weight": 5.0,
}


def build_targets(rows: list[dict]) -> list[dict]:
    """Add squeeze target.

    For each row i with |funding_zscore| > MIN_FUNDING_Z:
    1. Determine crowded side from funding sign
    2. Check if price moves >SQUEEZE_MOVE% against that side in next 1h
    3. Price move = price_trend_1h at i+12 minus price_trend_1h at i
       (approximation using the feature delta)

    More precisely, we use the long/short ROE labels at i to determine
    if the "against-crowd" side had a big move.
    """
    n = len(rows)

    for i, row in enumerate(rows):
        funding_z = row.get("funding_vs_30d_zscore")
        if funding_z is None or abs(funding_z) < MIN_FUNDING_Z:
            row["target_squeeze"] = None
            continue

        # Need future price data
        future_idx = i + LOOK_1H
        if future_idx >= n:
            row["target_squeeze"] = None
            continue

        # Use 1h gross ROE labels for the squeeze direction
        # We need the ROE at the FUTURE snapshot, but labels at i
        # only cover 30m forward. So use price_trend_1h at future snapshot
        # as a proxy for the price move over next 1h.
        future_trend = rows[future_idx].get("price_trend_1h")
        current_trend = row.get("price_trend_1h")

        if future_trend is None or current_trend is None:
            row["target_squeeze"] = None
            continue

        # Approximate 1h price change from current to future
        # price_trend_1h at i+12 captures close_now/close_1h_ago at that time
        # The move from i to i+12 ≈ future_trend (since future's 1h lookback
        # starts near current time)
        # More robust: use the 1h ROE labels directly
        long_1h = row.get("best_long_roe_1h_gross")
        short_1h = row.get("best_short_roe_1h_gross")

        if long_1h is None or short_1h is None:
            row["target_squeeze"] = None
            continue

        if funding_z > 0:
            # Longs crowded → long squeeze if price drops hard
            # Short side profits = price dropped
            row["target_squeeze"] = 1 if short_1h > SQUEEZE_MOVE else 0
        else:
            # Shorts crowded → short squeeze if price rips up
            # Long side profits = price rose
            row["target_squeeze"] = 1 if long_1h > SQUEEZE_MOVE else 0

    squeeze_count = sum(1 for r in rows if r.get("target_squeeze") == 1)
    total = sum(1 for r in rows if r.get("target_squeeze") is not None)
    excluded = len(rows) - total
    if total > 0:
        log.info("Squeeze rate: %d / %d = %.1f%% (excluded %d neutral-funding rows)",
                 squeeze_count, total, 100 * squeeze_count / total, excluded)

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
             if r.get("target_squeeze") is not None
             and all(r.get(f) is not None for f in FEATURES)]

    log.info("Valid rows: %d / %d", len(valid), len(rows))

    if not valid:
        log.error("No valid rows")
        sys.exit(1)

    X = np.array([[row[f] for f in FEATURES] for row in valid], dtype=np.float32)
    y = np.array([row["target_squeeze"] for row in valid], dtype=np.float32)

    pos_rate = y.mean() * 100
    log.info("Class balance: %.1f%% squeezes", pos_rate)

    # Dynamic scale_pos_weight
    if pos_rate > 0 and pos_rate < 50:
        params = {**XGBOOST_BINARY_RARE, "scale_pos_weight": (100 - pos_rate) / pos_rate}
    else:
        params = XGBOOST_BINARY

    baseline = 0.0
    if not args.no_baseline:
        baseline = run_permutation_baseline(
            X, y, FEATURES, params, EXPERIMENT_NAME, is_binary=True,
        )

    results, importance = run_walkforward(
        X, y, FEATURES, params, EXPERIMENT_NAME, is_binary=True,
    )

    summary = summarize(EXPERIMENT_NAME, DESCRIPTION, FEATURES,
                        len(valid), results, importance, baseline)
    print_report(summary)
    save_report(summary)


if __name__ == "__main__":
    main()
