"""Experiment: Liquidation Cascade Incoming

Predicts: Will a major liquidation cascade happen in the next 1h?
Features: OI + funding + vol + liq signals.
Label: Binary — liq_total_1h_usd at i+12 exceeds 95th percentile
       (expanding window, computed from training data only).

Why it should work: Cascades are preceded by OI buildup (oi_vs_7d_avg_ratio high),
crowded funding (oi_funding_pressure extreme), and rising vol. These features
structurally lead cascades by minutes to hours.

Cascades are where the real money is:
  - Entry: buy the cascade dip (liquidation = forced selling below fair value)
  - Exit: don't get caught holding into a cascade
  - Risk: cascade probability > X% → widen stops or reduce size

Statistical notes:
  - 95th percentile threshold computed per-fold with expanding window.
  - Class balance ~5% (cascades are rare). XGBOOST handles this with
    scale_pos_weight.
  - 48-snapshot embargo.

Usage:
    python -m satellite.experiments.exp_liq_cascade --db storage/satellite.db
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

EXPERIMENT_NAME = "liq_cascade_incoming"
DESCRIPTION = "Predict liquidation activity in next 1h (binary, any liq > 0)"

LOOK_1H = 12

FEATURES = [
    "oi_vs_7d_avg_ratio",
    "oi_change_rate_1h",
    "oi_funding_pressure",
    "funding_vs_30d_zscore",
    "funding_rate_raw",
    "funding_velocity",
    "realized_vol_1h",
    "realized_vol_4h",
    "vol_of_vol",
    "liq_total_1h_usd",
    "liq_1h_vs_4h_avg",
    "liq_imbalance_1h",
    "liq_cascade_active",
    "volume_acceleration",
    "price_trend_1h",
]

# Binary params with scale_pos_weight for rare events
XGBOOST_BINARY_RARE = {
    **XGBOOST_BINARY,
    "scale_pos_weight": 5.0,  # Upweight positive class (cascades)
}


def build_targets(rows: list[dict]) -> list[dict]:
    """Add cascade target: will there be liquidation activity in the next 1h?

    Target = 1 if liq_total_1h_usd at i+12 > 0 (any liq in next hour).
    Target = 0 if no liq activity.

    Simpler than percentile thresholds because BTC liq data is sparse
    (~1700 events across 58k snapshots).
    """
    n = len(rows)

    # Pre-extract liq values
    liqs = []
    for row in rows:
        val = row.get("liq_total_1h_usd")
        liqs.append(val if val is not None else 0.0)

    for i in range(n):
        future_idx = i + LOOK_1H
        if future_idx >= n:
            rows[i]["target_liq_cascade"] = None
            continue

        future_liq = liqs[future_idx]
        rows[i]["target_liq_cascade"] = 1 if future_liq > 0 else 0

    cascade_count = sum(1 for r in rows if r.get("target_liq_cascade") == 1)
    total = sum(1 for r in rows if r.get("target_liq_cascade") is not None)
    if total > 0:
        log.info("Liq activity rate: %d / %d = %.1f%%",
                 cascade_count, total, 100 * cascade_count / total)

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
             if r.get("target_liq_cascade") is not None
             and all(r.get(f) is not None for f in FEATURES)]

    log.info("Valid rows: %d / %d", len(valid), len(rows))

    if not valid:
        log.error("No valid rows")
        sys.exit(1)

    X = np.array([[row[f] for f in FEATURES] for row in valid], dtype=np.float32)
    y = np.array([row["target_liq_cascade"] for row in valid], dtype=np.float32)

    pos_rate = y.mean() * 100
    log.info("Class balance: %.1f%% cascades", pos_rate)

    # Adjust scale_pos_weight dynamically
    if pos_rate > 0:
        params = {**XGBOOST_BINARY_RARE, "scale_pos_weight": (100 - pos_rate) / pos_rate}
    else:
        params = XGBOOST_BINARY_RARE

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
