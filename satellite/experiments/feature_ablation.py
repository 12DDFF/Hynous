"""Feature ablation: test multiple feature combos for specific models.

Usage:
    python -m satellite.experiments.feature_ablation --db storage/satellite.db --data-db storage/hynous-data.db
"""

import logging
import sys
import numpy as np

from satellite.experiments.harness import (
    load_snapshots_with_labels,
    enrich_snapshots,
    run_walkforward,
    XGBOOST_BINARY,
)
from satellite.training.train_conditions import build_condition_targets

log = logging.getLogger(__name__)

# ── Feature set variants to test ──────────────────────────────────────────────

REVERSAL_VARIANTS = {
    "v0_current": [
        "return_autocorrelation", "price_trend_1h", "realized_vol_1h",
        "vol_of_vol", "cvd_acceleration", "liq_imbalance_1h",
        "oi_change_rate_1h", "funding_vs_30d_zscore",
        "body_ratio_1h", "upper_wick_ratio_1h",
    ],
    "v1_add_vol": [
        "return_autocorrelation", "price_trend_1h", "realized_vol_1h",
        "realized_vol_4h", "vol_of_vol", "volume_acceleration",
        "cvd_acceleration", "liq_imbalance_1h",
        "oi_change_rate_1h", "funding_vs_30d_zscore",
        "body_ratio_1h", "upper_wick_ratio_1h",
    ],
    "v2_add_funding": [
        "return_autocorrelation", "price_trend_1h", "realized_vol_1h",
        "vol_of_vol", "cvd_acceleration", "liq_imbalance_1h",
        "oi_change_rate_1h", "funding_vs_30d_zscore",
        "funding_rate_raw", "funding_velocity",
        "body_ratio_1h", "upper_wick_ratio_1h",
    ],
    "v3_vol_funding": [
        "return_autocorrelation", "price_trend_1h", "realized_vol_1h",
        "realized_vol_4h", "vol_of_vol", "volume_acceleration",
        "cvd_acceleration", "liq_imbalance_1h",
        "oi_change_rate_1h", "funding_vs_30d_zscore",
        "funding_rate_raw", "funding_velocity",
        "body_ratio_1h", "upper_wick_ratio_1h",
    ],
    "v4_kitchen_sink": [
        "return_autocorrelation", "price_trend_1h", "price_trend_4h",
        "realized_vol_1h", "realized_vol_4h", "vol_of_vol",
        "volume_acceleration", "volume_vs_1h_avg_ratio",
        "cvd_ratio_30m", "cvd_acceleration",
        "liq_imbalance_1h", "liq_total_1h_usd",
        "oi_change_rate_1h", "oi_vs_7d_avg_ratio",
        "funding_vs_30d_zscore", "funding_rate_raw", "funding_velocity",
        "body_ratio_1h", "upper_wick_ratio_1h",
        "close_position_5m",
    ],
    "v5_vol_heavy": [
        "realized_vol_1h", "realized_vol_4h", "vol_of_vol",
        "volume_acceleration", "volume_vs_1h_avg_ratio",
        "price_trend_1h", "return_autocorrelation",
        "oi_change_rate_1h", "liq_imbalance_1h",
        "body_ratio_1h",
    ],
    "v6_flow_heavy": [
        "cvd_ratio_30m", "cvd_acceleration",
        "volume_acceleration", "volume_vs_1h_avg_ratio",
        "oi_change_rate_1h", "oi_vs_7d_avg_ratio",
        "liq_imbalance_1h", "liq_total_1h_usd",
        "price_trend_1h", "funding_vs_30d_zscore",
    ],
    "v7_micro_only": [
        "return_autocorrelation", "body_ratio_1h", "upper_wick_ratio_1h",
        "close_position_5m", "cvd_acceleration",
        "volume_acceleration", "realized_vol_1h", "vol_of_vol",
    ],
}

MOMENTUM_VARIANTS = {
    "v0_current": [
        "volume_acceleration", "volume_vs_1h_avg_ratio", "cvd_ratio_30m",
        "cvd_acceleration", "oi_change_rate_1h", "body_ratio_1h",
        "return_autocorrelation", "realized_vol_1h", "price_trend_1h",
        "close_position_5m",
    ],
    "v1_add_vol4h": [
        "volume_acceleration", "volume_vs_1h_avg_ratio", "cvd_ratio_30m",
        "cvd_acceleration", "oi_change_rate_1h", "body_ratio_1h",
        "return_autocorrelation", "realized_vol_1h", "realized_vol_4h",
        "price_trend_1h", "close_position_5m",
    ],
    "v2_add_funding": [
        "volume_acceleration", "volume_vs_1h_avg_ratio", "cvd_ratio_30m",
        "cvd_acceleration", "oi_change_rate_1h", "body_ratio_1h",
        "return_autocorrelation", "realized_vol_1h", "price_trend_1h",
        "close_position_5m", "funding_vs_30d_zscore", "funding_rate_raw",
    ],
    "v3_expanded": [
        "volume_acceleration", "volume_vs_1h_avg_ratio", "cvd_ratio_30m",
        "cvd_ratio_1h", "cvd_acceleration", "oi_change_rate_1h",
        "oi_vs_7d_avg_ratio", "body_ratio_1h", "upper_wick_ratio_1h",
        "return_autocorrelation", "realized_vol_1h", "realized_vol_4h",
        "vol_of_vol", "price_trend_1h", "close_position_5m",
    ],
    "v4_minimal": [
        "volume_acceleration", "volume_vs_1h_avg_ratio",
        "cvd_ratio_30m", "cvd_acceleration",
        "realized_vol_1h", "oi_change_rate_1h",
        "price_trend_1h",
    ],
}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="storage/satellite.db")
    parser.add_argument("--data-db", required=True)
    parser.add_argument("--coin", default="BTC")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    log.info("Loading + enriching data...")
    rows = load_snapshots_with_labels(args.db, args.coin)
    rows = enrich_snapshots(rows, args.coin, args.data_db)
    rows = build_condition_targets(rows)
    log.info("Data ready: %d rows", len(rows))

    # ── Test reversal_30m variants ──
    print("\n" + "=" * 80)
    print("REVERSAL_30M FEATURE ABLATION")
    print("=" * 80)

    for name, features in REVERSAL_VARIANTS.items():
        valid = [r for r in rows
                 if r.get("target_reversal_30m") is not None
                 and all(r.get(f) is not None for f in features)]

        if len(valid) < 20000:
            print(f"  {name:<20} SKIP — only {len(valid)} valid rows")
            continue

        X = np.array([[row[f] for f in features] for row in valid], dtype=np.float32)
        y = np.array([row["target_reversal_30m"] for row in valid], dtype=np.float32)

        results, importance = run_walkforward(
            X, y, features, XGBOOST_BINARY, f"rev30m_{name}", is_binary=True,
        )

        if results:
            avg_sp = np.mean([r.spearman for r in results])
            std_sp = np.std([r.spearman for r in results])
            sig = sum(1 for r in results if r.spearman_pval < 0.05)
            avg_auc = np.mean([r.auc for r in results if r.auc is not None and r.auc == r.auc])
            top3 = sorted(importance.items(), key=lambda x: -x[1])[:3]
            top_str = ", ".join(f"{k}={v:.0f}" for k, v in top3)
            print(f"  {name:<20} sp={avg_sp:+.4f} ±{std_sp:.4f}  auc={avg_auc:.3f}  sig={sig}/{len(results)}  feat={len(features)}  top: {top_str}")
        else:
            print(f"  {name:<20} NO RESULTS")

    # ── Test momentum_quality variants ──
    print("\n" + "=" * 80)
    print("MOMENTUM_QUALITY FEATURE ABLATION")
    print("=" * 80)

    # momentum_quality is regression, use default params
    from satellite.experiments.harness import XGBOOST_HUBER as XGBOOST_REGRESSION
    for name, features in MOMENTUM_VARIANTS.items():
        valid = [r for r in rows
                 if r.get("target_momentum_quality") is not None
                 and all(r.get(f) is not None for f in features)]

        if len(valid) < 20000:
            print(f"  {name:<20} SKIP — only {len(valid)} valid rows")
            continue

        X = np.array([[row[f] for f in features] for row in valid], dtype=np.float32)
        y = np.array([row["target_momentum_quality"] for row in valid], dtype=np.float32)

        results, importance = run_walkforward(
            X, y, features, XGBOOST_REGRESSION, f"mom_{name}", is_binary=False,
        )

        if results:
            avg_sp = np.mean([r.spearman for r in results])
            std_sp = np.std([r.spearman for r in results])
            sig = sum(1 for r in results if r.spearman_pval < 0.05)
            top3 = sorted(importance.items(), key=lambda x: -x[1])[:3]
            top_str = ", ".join(f"{k}={v:.0f}" for k, v in top3)
            print(f"  {name:<20} sp={avg_sp:+.4f} ±{std_sp:.4f}  sig={sig}/{len(results)}  feat={len(features)}  top: {top_str}")
        else:
            print(f"  {name:<20} NO RESULTS")

    print("\n" + "=" * 80)
    print("DONE")
    print("=" * 80)


if __name__ == "__main__":
    main()
