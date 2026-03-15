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
    # Predict future volatility. Need vol history + volume catalysts + structure.
    # Vol models benefit from vol/volume dynamics, not crowding signals.
    # Keep v1 features that are vol-relevant (100% available).
    "vol_1h": [
        "realized_vol_1h",          # Current vol (strongest predictor — vol is persistent)
        "volume_vs_1h_avg_ratio",   # Volume spikes precede vol expansion
        "oi_vs_7d_avg_ratio",       # High OI = more liq cascades = vol amplifier
        "price_trend_1h",           # Trending markets have different vol profiles
        "hours_to_funding",         # Vol clusters around funding settlement
        "cvd_ratio_30m",            # Directional flow predicts breakout vol
        "liq_cascade_active",       # Active cascade = vol spike in progress
        "liq_1h_vs_4h_avg",        # Liq acceleration = building vol pressure
        "liq_imbalance_1h",        # One-sided liqs = directional vol
        "oi_funding_pressure",      # OI × funding = squeeze vol potential
        "funding_vs_30d_zscore",    # Extreme funding = reversion vol
        "oi_price_direction",       # Crowded positioning = snap-back vol risk
    ],
    "vol_4h": [
        "realized_vol_1h",
        "volume_vs_1h_avg_ratio",
        "oi_vs_7d_avg_ratio",
        "price_trend_1h",
        "hours_to_funding",
        "cvd_ratio_30m",
        "liq_cascade_active",
        "liq_1h_vs_4h_avg",
        "liq_imbalance_1h",
        "oi_funding_pressure",
        "funding_vs_30d_zscore",
        "oi_price_direction",
    ],
    "vol_expand": [
        "realized_vol_1h",
        "volume_vs_1h_avg_ratio",
        "hours_to_funding",
        "price_trend_1h",
        "cvd_ratio_30m",
        "funding_vs_30d_zscore",
        "oi_vs_7d_avg_ratio",
        "liq_cascade_active",
        "liq_1h_vs_4h_avg",
        "oi_price_direction",
        "oi_funding_pressure",
        "liq_imbalance_1h",
    ],

    # --- Move/Range cluster ---
    # These predict how much price will move. Need vol + direction + momentum.
    # Range/Move: predicts total price movement in next 30m.
    # v3 sparse features (realized_vol_4h, volume_acceleration, cvd_acceleration,
    # oi_change_rate_1h) replaced with v1 crowding signals (same approach that
    # improved MAE from Spearman 0.13→0.30).
    "range_30m": [
        "realized_vol_1h",
        "volume_vs_1h_avg_ratio",
        "price_trend_1h",
        "cvd_ratio_30m",
        "oi_vs_7d_avg_ratio",
        "funding_vs_30d_zscore",
        "liq_cascade_active",
        "oi_price_direction",
        "hours_to_funding",
        "liq_1h_vs_4h_avg",
        "liq_imbalance_1h",
        "oi_funding_pressure",
    ],
    "move_30m": [
        "realized_vol_1h",
        "volume_vs_1h_avg_ratio",
        "price_trend_1h",
        "cvd_ratio_30m",
        "oi_vs_7d_avg_ratio",
        "funding_vs_30d_zscore",
        "liq_cascade_active",
        "oi_price_direction",
        "hours_to_funding",
        "liq_1h_vs_4h_avg",
        "liq_imbalance_1h",
        "oi_funding_pressure",
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
        "oi_vs_7d_avg_ratio",
        "liq_cascade_active",
        "oi_price_direction",
        "hours_to_funding",
        "liq_1h_vs_4h_avg",
        "oi_funding_pressure",
    ],
    "mae_short": [
        "realized_vol_1h",
        "price_trend_1h",
        "liq_imbalance_1h",
        "volume_vs_1h_avg_ratio",
        "cvd_ratio_30m",
        "funding_vs_30d_zscore",
        "oi_vs_7d_avg_ratio",
        "liq_cascade_active",
        "oi_price_direction",
        "hours_to_funding",
        "liq_1h_vs_4h_avg",
        "oi_funding_pressure",
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
    # Predicts whether NOW is better than recent entries. Needs flow + crowding.
    # v3 sparse features (cvd_ratio_1h, cvd_acceleration, close_position_5m,
    # volume_acceleration) replaced with v1 crowding signals.
    "entry_quality": [
        "cvd_ratio_30m",
        "price_trend_1h",
        "volume_vs_1h_avg_ratio",
        "realized_vol_1h",
        "funding_vs_30d_zscore",
        "oi_vs_7d_avg_ratio",
        "oi_price_direction",
        "liq_cascade_active",
        "liq_imbalance_1h",
        "hours_to_funding",
        "liq_1h_vs_4h_avg",
        "oi_funding_pressure",
    ],

    # --- Funding model ---
    # Predicts funding rate trajectory over 4h. Original feature set restored
    # now that candles_history is backfilled and enrich_with_new_features() works.
    # v3 features (funding_rate_raw, funding_velocity, oi_change_rate_1h) are
    # critical for this model — it dropped from Sp 0.48 to 0.27 without them.
    # funding_rate_raw and funding_velocity now backfilled (14K records Aug 2025 – Mar 2026).
    # oi_change_rate_1h dropped — oi_history only covers Mar 2026 (no backfill yet).
    "funding_4h": [
        "funding_vs_30d_zscore",
        "funding_rate_raw",         # v3 — absolute funding magnitude (backfilled)
        "funding_velocity",         # v3 — funding direction change (backfilled)
        "hours_to_funding",
        "oi_funding_pressure",
        "oi_vs_7d_avg_ratio",
        "liq_1h_vs_4h_avg",
        "realized_vol_1h",
        "volume_vs_1h_avg_ratio",
        "price_trend_1h",
        "cvd_acceleration",
        "liq_cascade_active",
    ],

    # --- Volume model ---
    # Predicts future volume intensity. Original feature set restored with v3
    # features that made it strong (Sp 0.66). volume_acceleration and
    # cvd_acceleration are critical flow/volume dynamics signals.
    "volume_1h": [
        "volume_vs_1h_avg_ratio",
        "volume_acceleration",      # v3 — sudden volume surges
        "realized_vol_1h",
        "oi_vs_7d_avg_ratio",
        "oi_change_rate_1h",        # v3 — money flow
        "hours_to_funding",
        "cvd_ratio_30m",
        "cvd_acceleration",
        "price_trend_1h",
        "liq_total_1h_usd",        # v3 — liquidation force magnitude
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
