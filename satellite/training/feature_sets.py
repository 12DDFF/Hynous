"""Per-model feature set definitions.

Each condition model gets its own curated feature subset instead of
the same 14 features. This lets us:
  - Give each model only the signals relevant to its prediction
  - Add new features to specific models without retraining everything
  - Experiment with different combos in parallel

The FULL_FEATURES list is the superset of all available features.
Each model's feature set is a subset of this.
"""

# ─── Full Feature Superset (28 features) ────────────────────────────────────
#
# Original 14 (all remain available):
#   oi_vs_7d_avg_ratio, liq_cascade_active, liq_1h_vs_4h_avg,
#   funding_vs_30d_zscore, hours_to_funding, oi_funding_pressure,
#   volume_vs_1h_avg_ratio, realized_vol_1h, cvd_ratio_30m, cvd_acceleration,
#   price_trend_1h, close_position_5m, oi_price_direction, liq_imbalance_1h
#
# v3 (8):
#   realized_vol_4h      — stdev of 1m log returns over 4h (structural vol)
#   vol_of_vol           — stdev of rolling 15min vols over 1h (regime stability)
#   oi_change_rate_1h    — raw OI % change over 1h (money flow, no interaction)
#   funding_rate_raw     — absolute funding rate (magnitude context)
#   volume_acceleration  — recent 5m volume / 1h avg (sudden surges)
#   cvd_ratio_1h         — buy-sell imbalance over 1h (sustained pressure)
#   liq_total_1h_usd     — log10(total liquidation USD in 1h) (force magnitude)
#   price_trend_4h       — % price change over 4h (structural trend)
#
# v4 (6):
#   return_autocorrelation — autocorr of 5m log returns over 1h (trending vs mean-reverting)
#   body_ratio_1h          — avg |close-open|/(high-low) over 1h (conviction)
#   upper_wick_ratio_1h    — avg (high-max(o,c))/(h-l) over 1h (selling pressure)
#   funding_velocity       — current_rate - rate_8h_ago (funding direction)
#   hour_sin               — sin(2*pi*hour/24) (cyclical time)
#   hour_cos               — cos(2*pi*hour/24) (cyclical time)

FULL_FEATURES: list[str] = [
    # Liquidation mechanism
    "oi_vs_7d_avg_ratio",
    "liq_cascade_active",
    "liq_1h_vs_4h_avg",
    "liq_imbalance_1h",
    "liq_total_1h_usd",          # NEW
    # Funding mechanism
    "funding_vs_30d_zscore",
    "hours_to_funding",
    "oi_funding_pressure",
    "funding_rate_raw",          # NEW
    # OI dynamics
    "oi_change_rate_1h",         # NEW
    "oi_price_direction",
    # Volatility
    "realized_vol_1h",
    "realized_vol_4h",           # NEW
    "vol_of_vol",                # NEW
    # Volume
    "volume_vs_1h_avg_ratio",
    "volume_acceleration",       # NEW
    # Order flow / CVD
    "cvd_ratio_30m",
    "cvd_ratio_1h",              # NEW
    "cvd_acceleration",
    # Price action
    "price_trend_1h",
    "price_trend_4h",            # NEW
    "close_position_5m",
    # Microstructure
    "return_autocorrelation",    # NEW v4
    "body_ratio_1h",             # NEW v4
    "upper_wick_ratio_1h",       # NEW v4
    # Funding dynamics
    "funding_velocity",          # NEW v4
    # Time encoding
    "hour_sin",                  # NEW v4
    "hour_cos",                  # NEW v4
]

# ─── Per-Model Feature Sets ─────────────────────────────────────────────────

MODEL_FEATURES: dict[str, list[str]] = {
    # --- Volatility cluster ---
    # These predict future volatility. Heavy on vol + volume + OI dynamics.
    "vol_1h": [
        "realized_vol_1h",
        "realized_vol_4h",
        "vol_of_vol",
        "volume_vs_1h_avg_ratio",
        "volume_acceleration",
        "oi_vs_7d_avg_ratio",
        "oi_change_rate_1h",
        "price_trend_1h",
        "hours_to_funding",
        "liq_total_1h_usd",
    ],
    "vol_4h": [
        "realized_vol_1h",
        "realized_vol_4h",
        "vol_of_vol",
        "volume_vs_1h_avg_ratio",
        "volume_acceleration",
        "oi_vs_7d_avg_ratio",
        "oi_change_rate_1h",
        "price_trend_1h",
        "price_trend_4h",
        "hours_to_funding",
        "liq_imbalance_1h",
        "liq_total_1h_usd",
    ],
    "vol_expand": [
        "realized_vol_1h",
        "realized_vol_4h",
        "vol_of_vol",
        "volume_vs_1h_avg_ratio",
        "volume_acceleration",
        "hours_to_funding",
        "price_trend_1h",
        "cvd_ratio_30m",
        "oi_change_rate_1h",
    ],

    # --- Move/Range cluster ---
    # These predict how much price will move. Need vol + direction + momentum.
    "range_30m": [
        "realized_vol_1h",
        "realized_vol_4h",
        "volume_vs_1h_avg_ratio",
        "volume_acceleration",
        "price_trend_1h",
        "cvd_ratio_30m",
        "cvd_acceleration",
        "oi_vs_7d_avg_ratio",
        "oi_change_rate_1h",
        "funding_vs_30d_zscore",
    ],
    "move_30m": [
        "realized_vol_1h",
        "realized_vol_4h",
        "volume_vs_1h_avg_ratio",
        "volume_acceleration",
        "price_trend_1h",
        "cvd_ratio_30m",
        "cvd_acceleration",
        "oi_vs_7d_avg_ratio",
        "oi_change_rate_1h",
        "funding_vs_30d_zscore",
    ],

    # --- Risk cluster ---
    # Predicts max drawdown (MAE) for long/short entries. Needs vol + crowding + liq context.
    # Previous version was a vol proxy (Spearman +0.33 in high vol, +0.06 in low vol).
    # Added crowding signals (OI, liq cascade, funding pressure) to capture WHY drawdowns
    # happen beyond just "vol is high." All v1 features (100% data availability).
    # v1 features ONLY (100% availability in 60K+ snapshots).
    # v3 features (realized_vol_4h, price_trend_4h, liq_total_1h_usd,
    # oi_change_rate_1h, funding_velocity) only have 2-4% coverage — excluded.
    "mae_long": [
        "realized_vol_1h",
        "price_trend_1h",
        "liq_imbalance_1h",
        "volume_vs_1h_avg_ratio",
        "cvd_ratio_30m",
        "funding_vs_30d_zscore",
        # Crowding signals
        "oi_vs_7d_avg_ratio",       # Elevated OI = more forced exits on dips
        "liq_cascade_active",       # Active cascade = amplified drawdowns
        "oi_price_direction",       # OI flowing with/against price
        "hours_to_funding",         # Near settlement = forced exit pressure
        "liq_1h_vs_4h_avg",        # Liquidation acceleration
        "oi_funding_pressure",      # OI growth × funding interaction
        "funding_rate_raw",         # Absolute funding (long bias = long squeeze risk)
    ],
    "mae_short": [
        "realized_vol_1h",
        "price_trend_1h",
        "liq_imbalance_1h",
        "volume_vs_1h_avg_ratio",
        "cvd_ratio_30m",
        "funding_vs_30d_zscore",
        # Crowding signals
        "oi_vs_7d_avg_ratio",
        "liq_cascade_active",
        "oi_price_direction",
        "hours_to_funding",
        "liq_1h_vs_4h_avg",
        "oi_funding_pressure",
        "funding_rate_raw",
    ],
    # SL survival: uses only v1 features (available in all 60K+ snapshots).
    # v3 features (vol_of_vol, volume_acceleration, etc.) only exist in ~2K recent rows,
    # far below the 21K minimum for walk-forward training.
    "sl_survival_03": [
        "realized_vol_1h",
        "volume_vs_1h_avg_ratio",
        "oi_vs_7d_avg_ratio",
        "funding_vs_30d_zscore",
        "price_trend_1h",
        "cvd_ratio_30m",
        "liq_cascade_active",
        "liq_1h_vs_4h_avg",
        "oi_funding_pressure",
        "hours_to_funding",
    ],
    "sl_survival_05": [
        "realized_vol_1h",
        "volume_vs_1h_avg_ratio",
        "oi_vs_7d_avg_ratio",
        "funding_vs_30d_zscore",
        "price_trend_1h",
        "cvd_ratio_30m",
        "liq_cascade_active",
        "liq_1h_vs_4h_avg",
        "oi_funding_pressure",
        "hours_to_funding",
    ],

    # --- Entry quality ---
    # Predicts whether NOW is better than recent entries. Needs flow + momentum.
    "entry_quality": [
        "cvd_ratio_30m",
        "cvd_ratio_1h",
        "cvd_acceleration",
        "price_trend_1h",
        "close_position_5m",
        "volume_vs_1h_avg_ratio",
        "volume_acceleration",
        "realized_vol_1h",
        "oi_price_direction",
        "funding_vs_30d_zscore",
    ],

    # --- Funding model ---
    # Predicts funding trajectory. Needs funding + OI + indirect helpers.
    "funding_4h": [
        "funding_vs_30d_zscore",
        "funding_rate_raw",
        "funding_velocity",
        "hours_to_funding",
        "oi_funding_pressure",
        "oi_vs_7d_avg_ratio",
        "oi_change_rate_1h",
        "liq_1h_vs_4h_avg",
        "realized_vol_1h",
        "volume_vs_1h_avg_ratio",
        "price_trend_1h",
        "cvd_acceleration",
    ],

    # --- Volume model ---
    # Predicts future volume. Needs volume history + catalysts.
    "volume_1h": [
        "volume_vs_1h_avg_ratio",
        "volume_acceleration",
        "realized_vol_1h",
        "oi_vs_7d_avg_ratio",
        "oi_change_rate_1h",
        "hours_to_funding",
        "cvd_ratio_30m",
        "cvd_acceleration",
        "price_trend_1h",
        "liq_total_1h_usd",
    ],

    # --- Reversal cluster ---
    # v5_vol_heavy won ablation: +0.1074 sp (up from 0.0996)
    # Reversal prediction is fundamentally a volatility problem.
    "reversal_30m": [
        "realized_vol_1h",
        "realized_vol_4h",
        "vol_of_vol",
        "volume_acceleration",
        "volume_vs_1h_avg_ratio",
        "price_trend_1h",
        "return_autocorrelation",
        "oi_change_rate_1h",
        "liq_imbalance_1h",
        "body_ratio_1h",
    ],

    # --- Momentum quality ---
    # v1_add_vol4h marginally best: +0.4435 sp (from 0.4400)
    "momentum_quality": [
        "volume_acceleration",
        "volume_vs_1h_avg_ratio",
        "cvd_ratio_30m",
        "cvd_acceleration",
        "oi_change_rate_1h",
        "body_ratio_1h",
        "return_autocorrelation",
        "realized_vol_1h",
        "realized_vol_4h",
        "price_trend_1h",
        "close_position_5m",
    ],
}


def get_features_for_model(model_name: str) -> list[str]:
    """Get the feature set for a model. Falls back to FULL_FEATURES if unknown."""
    return MODEL_FEATURES.get(model_name, FULL_FEATURES)
