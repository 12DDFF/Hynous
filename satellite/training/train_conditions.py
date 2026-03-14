"""Training script for condition prediction models.

Trains 10 condition models using walk-forward validation with the same
parameters proven in v7/v8 experiments. Run on VPS:

    python -m satellite.training.train_conditions

Each model predicts a different market condition (volatility, move size,
drawdown risk, etc.) using the same 14 structural features.
"""

import argparse
import hashlib
import json
import logging
import math
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import xgboost as xgb
from scipy.stats import spearmanr

from satellite.features import FEATURE_NAMES
from satellite.training.feature_sets import get_features_for_model
from satellite.training.condition_artifact import (
    ConditionArtifact,
    ConditionMetadata,
    _compute_feature_hash,
)

log = logging.getLogger(__name__)

# ─── Target Definitions ──────────────────────────────────────────────────────

# Look-ahead constants (in snapshot indices, 1 index = 300s = 5min)
LOOK_1H = 12    # 12 * 5min = 60min
LOOK_4H = 48    # 48 * 5min = 240min
LOOK_30M = 6    # 6 * 5min = 30min


@dataclass
class ConditionTarget:
    """Definition of a single condition prediction target."""
    name: str
    description: str
    build_fn_name: str  # name of the function that computes the target


CONDITION_TARGETS: list[ConditionTarget] = [
    ConditionTarget("vol_1h", "Future realized_vol_1h (12 snapshots ahead)", "target_vol_1h"),
    ConditionTarget("vol_4h", "Avg realized_vol_1h over next 48 snapshots", "target_vol_4h"),
    ConditionTarget("range_30m", "abs(long_roe) + abs(short_roe) from 30m labels", "target_range_30m"),
    ConditionTarget("move_30m", "max(abs(long_roe), abs(short_roe)) from 30m labels", "target_move_30m"),
    ConditionTarget("volume_1h", "Future volume_vs_1h_avg_ratio (12 snapshots ahead)", "target_volume_1h"),
    ConditionTarget("entry_quality", "long_roe minus mean of recent 6 long_roes", "target_entry_quality"),
    ConditionTarget("mae_short", "abs(worst_short_mae_30m)", "target_mae_short"),
    ConditionTarget("vol_expand", "Future vol / current vol ratio", "target_vol_expand"),
    ConditionTarget("mae_long", "abs(worst_long_mae_30m)", "target_mae_long"),
    ConditionTarget("funding_4h", "Future funding_zscore minus current (48 ahead)", "target_funding_4h"),
    ConditionTarget("sl_survival_03", "P(0.3% SL hit within 30m for long)", "target_sl_hit_0_3"),
    ConditionTarget("sl_survival_05", "P(0.5% SL hit within 30m for long)", "target_sl_hit_0_5"),
    ConditionTarget("reversal_30m", "P(price reverses >0.3% in next 30m)", "target_reversal_30m"),
    ConditionTarget("momentum_quality", "Volume-backed momentum ratio at i+6", "target_momentum_quality"),
]

# ─── XGBoost Parameters (proven in v7/v8 experiments) ────────────────────────

XGBOOST_PARAMS = {
    "objective": "reg:pseudohubererror",  # Huber loss — robust to outliers
    "max_depth": 4,
    "learning_rate": 0.03,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 10,
    "gamma": 0.1,
    "verbosity": 0,
}

# Targets with larger value ranges need more aggressive params (matching v7/v8 experiments)
XGBOOST_PARAMS_AGGRESSIVE = {
    "objective": "reg:squarederror",
    "max_depth": 5,
    "learning_rate": 0.1,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 5,
    "gamma": 0.0,
    "verbosity": 0,
}

# Binary classification params (logistic output, 0-1 probability)
XGBOOST_PARAMS_BINARY = {
    "objective": "binary:logistic",
    "eval_metric": "logloss",
    "max_depth": 4,
    "learning_rate": 0.03,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "min_child_weight": 10,
    "gamma": 0.1,
    "verbosity": 0,
}

# Targets that need aggressive params (ROE-scale values)
AGGRESSIVE_TARGETS = {"range_30m", "move_30m", "mae_long", "mae_short", "entry_quality"}

# Binary classification targets (use logistic objective, no target clipping)
BINARY_TARGETS = {"sl_survival_03", "sl_survival_05", "reversal_30m"}

NUM_BOOST_ROUNDS = 500
EARLY_STOPPING_ROUNDS = 50

# Walk-forward parameters
MIN_TRAIN_DAYS = 60
TEST_DAYS = 14
STEP_DAYS = 7
SNAPSHOTS_PER_DAY = 288  # 24h * 60min / 5min
EMBARGO_SNAPSHOTS = 48   # 4h gap between train and test (matches longest look-ahead)
VAL_FRACTION = 0.20      # 20% of training window used for early stopping


# ─── Data Loading ────────────────────────────────────────────────────────────

def load_snapshots_with_labels(db_path: str, coin: str) -> list[dict]:
    """Load all labeled snapshots for a coin, sorted by time ascending.

    Joins snapshots with snapshot_labels to get both features and outcome labels.

    Args:
        db_path: Path to satellite.db.
        coin: Coin symbol (e.g., "BTC").

    Returns:
        List of dicts with all feature columns + label columns, sorted by created_at.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT s.*, l.*
        FROM snapshots s
        JOIN snapshot_labels l ON s.snapshot_id = l.snapshot_id
        WHERE s.coin = ? AND l.label_version > 0
        ORDER BY s.created_at ASC
        """,
        (coin,),
    ).fetchall()

    conn.close()
    return [dict(row) for row in rows]


def enrich_with_new_features(rows: list[dict], coin: str, data_db_path: str) -> list[dict]:
    """Compute v3 features from data-layer DB for historical snapshots.

    Historical snapshots only have the original 14 features.
    This function bulk-computes the 8 new features from raw data tables
    (funding_history, oi_history, volume_history, liquidation_events,
    trade_flow_history, candles_history).

    Runs in ~30s for 57k snapshots (bulk queries, not per-row).
    """
    conn = sqlite3.connect(data_db_path)
    conn.row_factory = sqlite3.Row

    log.info("Enriching %d rows with v3 features from %s...", len(rows), data_db_path)

    # ── 1. liq_total_1h_usd: log10(total liq in 1h) ──
    # Already have liq data in raw_data from _compute_liq_cascade,
    # but for historical rows we need to query liquidation_events.
    # Bulk approach: for each row, sum liqs in [created_at - 3600, created_at]
    # We'll use a sliding window approach for efficiency.
    log.info("  Computing liq_total_1h_usd...")
    liq_rows = conn.execute(
        "SELECT occurred_at, size_usd FROM liquidation_events "
        "WHERE coin = ? ORDER BY occurred_at ASC",
        (coin,),
    ).fetchall()
    liq_times = [float(r["occurred_at"]) for r in liq_rows]
    liq_sizes = [float(r["size_usd"]) for r in liq_rows]

    liq_idx = 0
    for row in rows:
        t = row["created_at"]
        t_start = t - 3600
        total_liq = 0.0
        for j in range(len(liq_times)):
            if liq_times[j] < t_start:
                continue
            if liq_times[j] > t:
                break
            total_liq += liq_sizes[j]
        row["liq_total_1h_usd"] = math.log10(total_liq + 1) if total_liq > 0 else 0.0

    # ── 2. funding_rate_raw ──
    log.info("  Computing funding_rate_raw...")
    funding_rows = conn.execute(
        "SELECT recorded_at, rate FROM funding_history "
        "WHERE coin = ? ORDER BY recorded_at ASC",
        (coin,),
    ).fetchall()
    fund_times = [float(r["recorded_at"]) for r in funding_rows]
    fund_rates = [float(r["rate"]) for r in funding_rows]

    fidx = 0
    for row in rows:
        t = row["created_at"]
        # Find most recent funding rate before t
        rate = 0.0
        while fidx < len(fund_times) - 1 and fund_times[fidx + 1] <= t:
            fidx += 1
        if fidx < len(fund_times) and fund_times[fidx] <= t:
            rate = fund_rates[fidx]
        row["funding_rate_raw"] = rate
    fidx = 0  # reset for safety

    # ── 3. oi_change_rate_1h ──
    log.info("  Computing oi_change_rate_1h...")
    oi_rows = conn.execute(
        "SELECT recorded_at, oi_usd FROM oi_history "
        "WHERE coin = ? ORDER BY recorded_at ASC",
        (coin,),
    ).fetchall()
    oi_times = [float(r["recorded_at"]) for r in oi_rows]
    oi_vals = [float(r["oi_usd"]) for r in oi_rows]

    def _find_oi_at(target_t):
        """Binary search for OI closest to target_t."""
        lo, hi = 0, len(oi_times) - 1
        best = -1
        while lo <= hi:
            mid = (lo + hi) // 2
            if oi_times[mid] <= target_t:
                best = mid
                lo = mid + 1
            else:
                hi = mid - 1
        return oi_vals[best] if best >= 0 else 0.0

    for row in rows:
        t = row["created_at"]
        oi_now = _find_oi_at(t)
        oi_1h = _find_oi_at(t - 3600)
        if oi_1h > 0 and oi_now > 0:
            row["oi_change_rate_1h"] = (oi_now - oi_1h) / oi_1h * 100
        else:
            row["oi_change_rate_1h"] = 0.0

    # ── 4. price_trend_4h ──
    log.info("  Computing price_trend_4h...")
    candle_rows = conn.execute(
        "SELECT open_time, close FROM candles_history "
        "WHERE coin = ? AND interval = '5m' ORDER BY open_time ASC",
        (coin,),
    ).fetchall()
    candle_times = [float(r["open_time"]) for r in candle_rows]
    candle_closes = [float(r["close"]) for r in candle_rows]

    def _find_close_at(target_t):
        lo, hi = 0, len(candle_times) - 1
        best = -1
        while lo <= hi:
            mid = (lo + hi) // 2
            if candle_times[mid] <= target_t:
                best = mid
                lo = mid + 1
            else:
                hi = mid - 1
        return candle_closes[best] if best >= 0 else 0.0

    for row in rows:
        t = row["created_at"]
        close_now = _find_close_at(t)
        close_4h = _find_close_at(t - 4 * 3600)
        if close_4h > 0 and close_now > 0:
            row["price_trend_4h"] = (close_now - close_4h) / close_4h * 100
        else:
            row["price_trend_4h"] = 0.0

    # ── 5. volume_acceleration ──
    log.info("  Computing volume_acceleration...")
    vol_rows = conn.execute(
        "SELECT recorded_at, volume_usd FROM volume_history "
        "WHERE coin = ? ORDER BY recorded_at ASC",
        (coin,),
    ).fetchall()
    vol_times = [float(r["recorded_at"]) for r in vol_rows]
    vol_vals = [float(r["volume_usd"]) for r in vol_rows]

    def _sum_vol_between(t_start, t_end):
        lo, hi = 0, len(vol_times) - 1
        # find first >= t_start
        start_idx = len(vol_times)
        while lo <= hi:
            mid = (lo + hi) // 2
            if vol_times[mid] >= t_start:
                start_idx = mid
                hi = mid - 1
            else:
                lo = mid + 1
        total = 0.0
        for j in range(start_idx, len(vol_times)):
            if vol_times[j] > t_end:
                break
            total += vol_vals[j]
        return total

    for row in rows:
        t = row["created_at"]
        vol_5m = _sum_vol_between(t - 300, t)
        vol_1h = _sum_vol_between(t - 3600, t - 300)
        avg_5m = vol_1h / 11.0 if vol_1h > 0 else 0  # 55min / 5min = 11 buckets
        if avg_5m > 0 and vol_5m > 0:
            row["volume_acceleration"] = vol_5m / avg_5m
        else:
            row["volume_acceleration"] = 1.0

    # ── 6. cvd_ratio_1h ──
    log.info("  Computing cvd_ratio_1h...")
    tf_rows = conn.execute(
        "SELECT recorded_at, buy_volume_usd, sell_volume_usd "
        "FROM trade_flow_history WHERE coin = ? ORDER BY recorded_at ASC",
        (coin,),
    ).fetchall()
    tf_times = [float(r["recorded_at"]) for r in tf_rows]
    tf_buys = [float(r["buy_volume_usd"]) for r in tf_rows]
    tf_sells = [float(r["sell_volume_usd"]) for r in tf_rows]

    def _cvd_between(t_start, t_end):
        lo, hi = 0, len(tf_times) - 1
        start_idx = len(tf_times)
        while lo <= hi:
            mid = (lo + hi) // 2
            if tf_times[mid] >= t_start:
                start_idx = mid
                hi = mid - 1
            else:
                lo = mid + 1
        total_buy, total_sell = 0.0, 0.0
        for j in range(start_idx, len(tf_times)):
            if tf_times[j] > t_end:
                break
            total_buy += tf_buys[j]
            total_sell += tf_sells[j]
        return total_buy, total_sell

    for row in rows:
        t = row["created_at"]
        buy, sell = _cvd_between(t - 3600, t)
        total = buy + sell
        if total < 1:
            row["cvd_ratio_1h"] = 0.0
        else:
            row["cvd_ratio_1h"] = max(-1.0, min(1.0, (buy - sell) / total))

    # ── 7. realized_vol_4h (from 5m candles — approx) ──
    log.info("  Computing realized_vol_4h...")
    for row in rows:
        t = row["created_at"]
        # Find candles in [t-4h, t]
        t_start = t - 4 * 3600
        lo, hi = 0, len(candle_times) - 1
        start_idx = len(candle_times)
        while lo <= hi:
            mid = (lo + hi) // 2
            if candle_times[mid] >= t_start:
                start_idx = mid
                hi = mid - 1
            else:
                lo = mid + 1

        closes = []
        for j in range(start_idx, len(candle_times)):
            if candle_times[j] > t:
                break
            closes.append(candle_closes[j])

        if len(closes) < 10:
            row["realized_vol_4h"] = 0.0
            continue

        returns = []
        for i in range(1, len(closes)):
            if closes[i - 1] > 0 and closes[i] > 0:
                returns.append(math.log(closes[i] / closes[i - 1]))

        if len(returns) < 5:
            row["realized_vol_4h"] = 0.0
            continue

        mean_r = sum(returns) / len(returns)
        var_r = sum((r - mean_r) ** 2 for r in returns) / len(returns)
        # Scale: 5m candles, so sqrt(12) to annualize to 1h equivalent, * 100 for %
        row["realized_vol_4h"] = math.sqrt(var_r) * math.sqrt(12) * 100

    # ── 8. vol_of_vol (from 5m candles — approx using 15min windows) ──
    log.info("  Computing vol_of_vol...")
    for row in rows:
        t = row["created_at"]
        t_start = t - 3600
        lo, hi = 0, len(candle_times) - 1
        start_idx = len(candle_times)
        while lo <= hi:
            mid = (lo + hi) // 2
            if candle_times[mid] >= t_start:
                start_idx = mid
                hi = mid - 1
            else:
                lo = mid + 1

        closes = []
        for j in range(start_idx, len(candle_times)):
            if candle_times[j] > t:
                break
            closes.append(candle_closes[j])

        if len(closes) < 12:
            row["vol_of_vol"] = 0.0
            continue

        # 15min windows (3 candles each for 5m data)
        window_vols = []
        for ws in range(0, len(closes) - 2, 3):
            window = closes[ws:ws + 3]
            rets = []
            for i in range(1, len(window)):
                if window[i - 1] > 0 and window[i] > 0:
                    rets.append(math.log(window[i] / window[i - 1]))
            if len(rets) >= 2:
                mr = sum(rets) / len(rets)
                vr = sum((r - mr) ** 2 for r in rets) / len(rets)
                window_vols.append(math.sqrt(vr) * math.sqrt(12) * 100)

        if len(window_vols) < 3:
            row["vol_of_vol"] = 0.0
            continue

        mv = sum(window_vols) / len(window_vols)
        vv = sum((v - mv) ** 2 for v in window_vols) / len(window_vols)
        row["vol_of_vol"] = math.sqrt(vv)

    # ── 9. return_autocorrelation (from 5m candles) ──
    log.info("  Computing return_autocorrelation...")
    for row in rows:
        t = row["created_at"]
        t_start = t - 3600
        lo, hi = 0, len(candle_times) - 1
        start_idx = len(candle_times)
        while lo <= hi:
            mid = (lo + hi) // 2
            if candle_times[mid] >= t_start:
                start_idx = mid
                hi = mid - 1
            else:
                lo = mid + 1

        closes = []
        for j in range(start_idx, len(candle_times)):
            if candle_times[j] > t:
                break
            closes.append(candle_closes[j])

        if len(closes) < 8:
            row["return_autocorrelation"] = 0.0
            continue

        log_returns = []
        for k in range(1, len(closes)):
            if closes[k - 1] > 0 and closes[k] > 0:
                log_returns.append(math.log(closes[k] / closes[k - 1]))

        if len(log_returns) < 4:
            row["return_autocorrelation"] = 0.0
            continue

        r1 = log_returns[:-1]
        r2 = log_returns[1:]
        n_r = len(r1)
        m1 = sum(r1) / n_r
        m2 = sum(r2) / n_r
        cov = sum((r1[ii] - m1) * (r2[ii] - m2) for ii in range(n_r)) / n_r
        s1 = math.sqrt(sum((x - m1) ** 2 for x in r1) / n_r)
        s2 = math.sqrt(sum((x - m2) ** 2 for x in r2) / n_r)
        if s1 < 1e-12 or s2 < 1e-12:
            row["return_autocorrelation"] = 0.0
        else:
            row["return_autocorrelation"] = max(-1.0, min(1.0, cov / (s1 * s2)))

    # ── 10-11. body_ratio_1h + upper_wick_ratio_1h (from 5m candles) ──
    log.info("  Computing body_ratio_1h + upper_wick_ratio_1h...")
    # Need OHLC data — re-query candles with all fields
    candle_ohlc = conn.execute(
        "SELECT open_time, open, high, low, close FROM candles_history "
        "WHERE coin = ? AND interval = '5m' ORDER BY open_time ASC",
        (coin,),
    ).fetchall()
    co_times = [float(r["open_time"]) for r in candle_ohlc]
    co_opens = [float(r["open"]) for r in candle_ohlc]
    co_highs = [float(r["high"]) for r in candle_ohlc]
    co_lows = [float(r["low"]) for r in candle_ohlc]
    co_closes = [float(r["close"]) for r in candle_ohlc]

    for row in rows:
        t = row["created_at"]
        t_start = t - 3600
        lo, hi = 0, len(co_times) - 1
        start_idx = len(co_times)
        while lo <= hi:
            mid = (lo + hi) // 2
            if co_times[mid] >= t_start:
                start_idx = mid
                hi = mid - 1
            else:
                lo = mid + 1

        body_ratios = []
        wick_ratios = []
        for j in range(start_idx, len(co_times)):
            if co_times[j] > t:
                break
            h_val = co_highs[j]
            l_val = co_lows[j]
            rng = h_val - l_val
            if rng <= 0:
                continue
            body_ratios.append(abs(co_closes[j] - co_opens[j]) / rng)
            wick_ratios.append((h_val - max(co_opens[j], co_closes[j])) / rng)

        if len(body_ratios) >= 6:
            row["body_ratio_1h"] = sum(body_ratios) / len(body_ratios)
            row["upper_wick_ratio_1h"] = sum(wick_ratios) / len(wick_ratios)
        else:
            row["body_ratio_1h"] = 0.5
            row["upper_wick_ratio_1h"] = 0.5

    # ── 12. funding_velocity (current - 8h ago) ──
    log.info("  Computing funding_velocity...")
    for row in rows:
        t = row["created_at"]
        t_8h = t - 8 * 3600
        # Find current rate (reuse fund_times/fund_rates from earlier)
        curr_rate = 0.0
        past_rate = 0.0
        # Binary search for current
        lo_f, hi_f = 0, len(fund_times) - 1
        best_c = -1
        while lo_f <= hi_f:
            mid = (lo_f + hi_f) // 2
            if fund_times[mid] <= t:
                best_c = mid
                lo_f = mid + 1
            else:
                hi_f = mid - 1
        if best_c >= 0:
            curr_rate = fund_rates[best_c]
        # Binary search for 8h ago
        lo_f, hi_f = 0, len(fund_times) - 1
        best_p = -1
        while lo_f <= hi_f:
            mid = (lo_f + hi_f) // 2
            if fund_times[mid] <= t_8h:
                best_p = mid
                lo_f = mid + 1
            else:
                hi_f = mid - 1
        if best_p >= 0:
            past_rate = fund_rates[best_p]
        row["funding_velocity"] = curr_rate - past_rate

    # ── 13-14. hour_sin + hour_cos (from timestamp) ──
    log.info("  Computing hour_sin + hour_cos...")
    for row in rows:
        t = row["created_at"]
        dt = datetime.fromtimestamp(t, tz=timezone.utc)
        hour_frac = dt.hour + dt.minute / 60 + dt.second / 3600
        row["hour_sin"] = math.sin(2 * math.pi * hour_frac / 24)
        row["hour_cos"] = math.cos(2 * math.pi * hour_frac / 24)

    conn.close()
    log.info("  Enrichment complete — %d rows enriched", len(rows))
    return rows


# ─── Target Builders ─────────────────────────────────────────────────────────

def build_condition_targets(rows: list[dict]) -> list[dict]:
    """Add all 10 forward-looking targets to snapshot rows.

    Each target uses look-ahead by index (not time) to build the
    forward-looking value. Rows without a valid target get None.

    Args:
        rows: Snapshots sorted by created_at ascending.

    Returns:
        Same rows with target columns added (may be None if look-ahead unavailable).
    """
    n = len(rows)

    for i, row in enumerate(rows):
        # 1. vol_1h: realized_vol_1h at index i+12
        row["target_vol_1h"] = _safe_get(rows, i + LOOK_1H, "realized_vol_1h")

        # 2. vol_4h: average realized_vol_1h over next 48 snapshots
        future_vols = [
            rows[j].get("realized_vol_1h")
            for j in range(i + 1, min(i + LOOK_4H + 1, n))
            if rows[j].get("realized_vol_1h") is not None
        ]
        row["target_vol_4h"] = float(np.mean(future_vols)) if len(future_vols) >= LOOK_1H else None

        # 3. range_30m: abs(best_long_roe_30m_gross) + abs(best_short_roe_30m_gross)
        long_roe = row.get("best_long_roe_30m_gross")
        short_roe = row.get("best_short_roe_30m_gross")
        if long_roe is not None and short_roe is not None:
            row["target_range_30m"] = abs(long_roe) + abs(short_roe)
        else:
            row["target_range_30m"] = None

        # 4. move_30m: max(abs(best_long_roe_30m_gross), abs(best_short_roe_30m_gross))
        if long_roe is not None and short_roe is not None:
            row["target_move_30m"] = max(abs(long_roe), abs(short_roe))
        else:
            row["target_move_30m"] = None

        # 5. volume_1h: volume_vs_1h_avg_ratio at index i+12
        row["target_volume_1h"] = _safe_get(rows, i + LOOK_1H, "volume_vs_1h_avg_ratio")

        # 6. entry_quality: long_roe minus mean of previous 6 long_roes
        current_roe = row.get("best_long_roe_30m_net")
        if current_roe is not None and i >= 6:
            recent_roes = [
                rows[j].get("best_long_roe_30m_net")
                for j in range(i - 6, i)
                if rows[j].get("best_long_roe_30m_net") is not None
            ]
            if len(recent_roes) >= 3:
                row["target_entry_quality"] = current_roe - float(np.mean(recent_roes))
            else:
                row["target_entry_quality"] = None
        else:
            row["target_entry_quality"] = None

        # 7. mae_short: vol-normalized drawdown magnitude
        # Normalized by current realized vol so model learns "extra risk beyond vol"
        # instead of just "vol is high → drawdown is big". At inference, multiply
        # prediction by current vol to get actual drawdown in ROE%.
        mae_s = row.get("worst_short_mae_30m")
        current_vol = row.get("realized_vol_1h")
        if mae_s is not None and current_vol is not None and current_vol > 0.01:
            row["target_mae_short"] = abs(mae_s) / current_vol
        else:
            row["target_mae_short"] = None

        # 8. vol_expand: future_vol / current_vol ratio
        future_vol = _safe_get(rows, i + LOOK_1H, "realized_vol_1h")
        if future_vol is not None and current_vol is not None and current_vol > 1e-8:
            row["target_vol_expand"] = future_vol / current_vol
        else:
            row["target_vol_expand"] = None

        # 9. mae_long: vol-normalized drawdown magnitude (same as mae_short)
        mae_l = row.get("worst_long_mae_30m")
        if mae_l is not None and current_vol is not None and current_vol > 0.01:
            row["target_mae_long"] = abs(mae_l) / current_vol
        else:
            row["target_mae_long"] = None

        # 10. funding_4h: future_funding_zscore - current_funding_zscore
        future_funding = _safe_get(rows, i + LOOK_4H, "funding_vs_30d_zscore")
        current_funding = row.get("funding_vs_30d_zscore")
        if future_funding is not None and current_funding is not None:
            row["target_funding_4h"] = future_funding - current_funding
        else:
            row["target_funding_4h"] = None

        # 11-12. SL survival: did long-side MAE exceed SL threshold within 30m?
        # MAE is in ROE% (already leveraged). SL distance in price % * leverage = ROE threshold.
        mae_long_raw = row.get("worst_long_mae_30m")
        if mae_long_raw is not None:
            mae_abs = abs(mae_long_raw)
            row["target_sl_hit_0_3"] = 1 if mae_abs >= 0.3 * 20 else 0  # 0.3% price * 20x = 6% ROE
            row["target_sl_hit_0_5"] = 1 if mae_abs >= 0.5 * 20 else 0  # 0.5% price * 20x = 10% ROE
        else:
            row["target_sl_hit_0_3"] = None
            row["target_sl_hit_0_5"] = None

        # 13. trend_continuation: does price continue in current 1h direction?
        trend_1h = row.get("price_trend_1h")
        if trend_1h is not None and long_roe is not None and short_roe is not None:
            if trend_1h > 0:
                # Bullish trend — continuation if long ROE is positive
                row["target_trend_continuation"] = 1 if long_roe > 0 else 0
            elif trend_1h < 0:
                # Bearish trend — continuation if short ROE is positive
                row["target_trend_continuation"] = 1 if short_roe > 0 else 0
            else:
                row["target_trend_continuation"] = None  # no trend to continue
        else:
            row["target_trend_continuation"] = None

        # 14. reversal_30m: does price reverse >0.3% in opposite direction?
        if trend_1h is not None and long_roe is not None and short_roe is not None:
            if trend_1h > 0:
                # Bullish — reversal if short side moved >0.3%
                row["target_reversal_30m"] = 1 if short_roe > 0.3 else 0
            elif trend_1h < 0:
                # Bearish — reversal if long side moved >0.3%
                row["target_reversal_30m"] = 1 if long_roe > 0.3 else 0
            else:
                row["target_reversal_30m"] = None
        else:
            row["target_reversal_30m"] = None

        # 15. oi_flush: does OI drop >3% in the next 1h?
        future_oi = _safe_get(rows, i + LOOK_1H, "oi_vs_7d_avg_ratio")
        current_oi = row.get("oi_vs_7d_avg_ratio")
        if future_oi is not None and current_oi is not None and current_oi > 0:
            oi_drop_pct = (current_oi - future_oi) / current_oi * 100
            row["target_oi_flush"] = 1 if oi_drop_pct > 3 else 0
        else:
            row["target_oi_flush"] = None

        # 16. momentum_quality: abs(cvd_ratio_30m) * volume_vs_1h_avg_ratio at i+6
        future_cvd = _safe_get(rows, i + LOOK_30M, "cvd_ratio_30m")
        future_vol = _safe_get(rows, i + LOOK_30M, "volume_vs_1h_avg_ratio")
        if future_cvd is not None and future_vol is not None:
            row["target_momentum_quality"] = abs(future_cvd) * future_vol
        else:
            row["target_momentum_quality"] = None

    return rows


def _safe_get(rows: list[dict], idx: int, key: str):
    """Safely get a value from a row by index. Returns None if out of bounds or missing."""
    if idx < 0 or idx >= len(rows):
        return None
    return rows[idx].get(key)


# ─── Walk-Forward Training ───────────────────────────────────────────────────

def train_single_condition(
    rows: list[dict],
    target: ConditionTarget,
    feature_names: list[str] | None,
    output_dir: Path,
) -> dict:
    """Train one condition model with walk-forward validation.

    Args:
        rows: All snapshots with targets built (from build_condition_targets).
        target: The condition target definition.
        feature_names: List of feature column names. If None, uses per-model
            feature set from feature_sets.py.
        output_dir: Base artifacts directory (e.g. artifacts/conditions/).

    Returns:
        Dict with training results (avg_spearman, avg_mae, generation_count).
    """
    # Use per-model feature set if not explicitly provided
    if feature_names is None:
        feature_names = get_features_for_model(target.name)
    log.info("  Feature set for %s: %d features", target.name, len(feature_names))

    target_col = target.build_fn_name  # e.g. "target_vol_1h"

    # Filter to rows with valid target and features
    valid_rows = []
    for row in rows:
        target_val = row.get(target_col)
        if target_val is None:
            continue
        features_ok = all(
            row.get(f) is not None for f in feature_names
        )
        if features_ok:
            valid_rows.append(row)

    if len(valid_rows) < (MIN_TRAIN_DAYS + TEST_DAYS) * SNAPSHOTS_PER_DAY:
        log.warning(
            "Insufficient data for %s: %d rows (need %d)",
            target.name,
            len(valid_rows),
            (MIN_TRAIN_DAYS + TEST_DAYS) * SNAPSHOTS_PER_DAY,
        )
        return {"name": target.name, "status": "skipped", "reason": "insufficient_data"}

    # Build feature matrix and target vector
    X = np.array(
        [[row[f] for f in feature_names] for row in valid_rows],
        dtype=np.float32,
    )
    y_raw = np.array(
        [row[target_col] for row in valid_rows],
        dtype=np.float32,
    )

    # NOTE: target clipping is done PER-FOLD below to prevent future percentile leakage.
    # The raw y is kept for the final model training.

    # Walk-forward validation
    #
    # Split structure per generation:
    #   [===== TRAIN =====][= VAL =][/// EMBARGO ///][==== TEST ====]
    #
    # - TRAIN: model learns from this data
    # - VAL: last 20% of train window, used for early stopping only
    # - EMBARGO: 48 snapshots (4h) dead zone, prevents label leakage from
    #   overlapping forward-looking windows (vol_4h uses 48 snapshots ahead)
    # - TEST: evaluation only, model NEVER sees these labels
    min_train = MIN_TRAIN_DAYS * SNAPSHOTS_PER_DAY
    test_window = TEST_DAYS * SNAPSHOTS_PER_DAY
    step = STEP_DAYS * SNAPSHOTS_PER_DAY
    embargo = EMBARGO_SNAPSHOTS
    val_fraction = VAL_FRACTION

    results = []

    for gen, train_end in enumerate(range(min_train, len(X) - embargo - test_window, step)):
        test_start = train_end + embargo
        test_end = test_start + test_window

        if test_end > len(X):
            break

        # Split train into train + validation for early stopping
        val_size = max(int(train_end * val_fraction), SNAPSHOTS_PER_DAY)
        val_start = train_end - val_size

        X_train, y_train = X[:val_start], y_raw[:val_start].copy()
        X_val, y_val = X[val_start:train_end], y_raw[val_start:train_end].copy()
        X_test, y_test = X[test_start:test_end], y_raw[test_start:test_end]

        # Per-fold target clipping (skip for binary targets — they're already 0/1)
        is_binary = target.name in BINARY_TARGETS
        if not is_binary:
            p1, p99 = np.percentile(y_train, [1, 99])
            y_train = np.clip(y_train, p1, p99)
            y_val = np.clip(y_val, p1, p99)
            # DO NOT clip y_test — evaluate on raw values

        # Select params based on target type
        if is_binary:
            params = dict(XGBOOST_PARAMS_BINARY)  # copy — scale_pos_weight varies per fold
            pos = float(np.sum(y_train == 1))
            neg = float(np.sum(y_train == 0))
            if pos > 0:
                params["scale_pos_weight"] = neg / pos
            pos_rate = pos / (pos + neg) if (pos + neg) > 0 else 0
            if pos_rate < 0.05 or pos_rate > 0.95:
                log.warning(
                    "  Gen %d: extreme imbalance (pos_rate=%.1f%%) — skipping fold",
                    gen, pos_rate * 100,
                )
                continue
        elif target.name in AGGRESSIVE_TARGETS:
            params = XGBOOST_PARAMS_AGGRESSIVE
        else:
            params = XGBOOST_PARAMS

        # Early stopping uses VALIDATION set, NOT test set
        dtrain = xgb.DMatrix(X_train, label=y_train, feature_names=feature_names)
        dval = xgb.DMatrix(X_val, label=y_val, feature_names=feature_names)
        dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_names)

        model = xgb.train(
            params,
            dtrain,
            num_boost_round=NUM_BOOST_ROUNDS,
            evals=[(dval, "val")],
            early_stopping_rounds=EARLY_STOPPING_ROUNDS,
            verbose_eval=False,
        )

        # Evaluate on UNTOUCHED test set
        y_pred = model.predict(dtest)

        # Metrics with p-value
        sp, sp_pval = spearmanr(y_test, y_pred)
        if np.isnan(sp):
            sp = 0.0
            sp_pval = 1.0
        mae = float(np.mean(np.abs(y_test - y_pred)))
        centered_dir = 100 * float(np.mean(
            np.sign(y_test - np.mean(y_test)) == np.sign(y_pred - np.mean(y_pred))
        ))

        results.append({
            "generation": gen,
            "spearman": round(sp, 4),
            "spearman_pval": round(float(sp_pval), 6),
            "mae": round(mae, 4),
            "centered_dir": round(centered_dir, 1),
            "rounds": model.best_iteration + 1 if hasattr(model, "best_iteration") else NUM_BOOST_ROUNDS,
            "train_size": len(X_train),
            "val_size": len(X_val),
            "test_size": len(X_test),
        })

        log.info(
            "  Gen %d: sp=%.4f (p=%.4f)  mae=%.4f  dir=%.1f%%  rounds=%d  (train=%d, val=%d, test=%d)",
            gen, sp, sp_pval, mae, centered_dir,
            results[-1]["rounds"], len(X_train), len(X_val), len(X_test),
        )

    if not results:
        log.warning("No walk-forward generations completed for %s", target.name)
        return {"name": target.name, "status": "failed", "reason": "no_generations"}

    # Average metrics across generations (filter NaN spearman values)
    valid_spearmans = [r["spearman"] for r in results if not np.isnan(r["spearman"])]
    avg_spearman = float(np.mean(valid_spearmans)) if valid_spearmans else 0.0
    avg_mae = float(np.mean([r["mae"] for r in results]))
    avg_centered = float(np.mean([r["centered_dir"] for r in results]))

    log.info(
        "%s: AVG spearman=%.4f mae=%.4f centered=%.1f%% (%d gens)",
        target.name, avg_spearman, avg_mae, avg_centered, len(results),
    )

    # Train final model on ALL data
    is_binary = target.name in BINARY_TARGETS
    if is_binary:
        final_params = dict(XGBOOST_PARAMS_BINARY)  # copy for scale_pos_weight
        pos = float(np.sum(y_raw == 1))
        neg = float(np.sum(y_raw == 0))
        if pos > 0:
            final_params["scale_pos_weight"] = neg / pos
        pos_rate = pos / (pos + neg) if (pos + neg) > 0 else 0
        if pos_rate < 0.05 or pos_rate > 0.95:
            log.warning(
                "Skipping final model %s: extreme imbalance (pos_rate=%.1f%%)",
                target.name, pos_rate * 100,
            )
            return {"name": target.name, "status": "skipped", "reason": "extreme_imbalance"}
    elif target.name in AGGRESSIVE_TARGETS:
        final_params = XGBOOST_PARAMS_AGGRESSIVE
    else:
        final_params = XGBOOST_PARAMS

    # Clip final training targets (skip for binary — already 0/1)
    y_final = y_raw.copy()
    if not is_binary:
        p1_full, p99_full = np.percentile(y_final, [1, 99])
        y_final = np.clip(y_final, p1_full, p99_full)

    dtrain_full = xgb.DMatrix(X, label=y_final, feature_names=feature_names)
    # Use median best_iteration from walk-forward as final round count
    median_rounds = int(np.median([r["rounds"] for r in results]))
    final_model = xgb.train(
        final_params,
        dtrain_full,
        num_boost_round=max(median_rounds, 50),
        verbose_eval=False,
    )

    # Compute training-set percentiles for regime labeling
    y_pred_full = final_model.predict(dtrain_full)
    percentiles = {
        f"p{p}": round(float(np.percentile(y_pred_full, p)), 6)
        for p in [10, 25, 50, 75, 90, 95]
    }

    # Build and save artifact
    feature_hash = _compute_feature_hash(feature_names)
    metadata = ConditionMetadata(
        name=target.name,
        version=1,
        feature_hash=feature_hash,
        feature_names=feature_names,
        target_description=target.description,
        created_at=datetime.now(timezone.utc).isoformat(),
        training_samples=len(X),
        validation_spearman=round(avg_spearman, 4),
        validation_mae=round(avg_mae, 4),
        xgboost_params=final_params,
        percentiles=percentiles,
    )

    artifact = ConditionArtifact(model=final_model, metadata=metadata)
    artifact.save(output_dir)

    return {
        "name": target.name,
        "status": "success",
        "avg_spearman": avg_spearman,
        "avg_mae": avg_mae,
        "avg_centered_dir": avg_centered,
        "generations": len(results),
        "training_samples": len(X),
        "median_rounds": median_rounds,
        "results": results,
    }


# ─── Entry Point ─────────────────────────────────────────────────────────────

def train_all_conditions(
    db_path: str,
    output_dir: str,
    coin: str = "BTC",
    targets: list[str] | None = None,
    data_db_path: str | None = None,
) -> list[dict]:
    """Train all condition models for a coin.

    Args:
        db_path: Path to satellite.db.
        output_dir: Path to artifacts/conditions/ directory.
        coin: Coin to train on (default "BTC").
        targets: Optional list of target names to train (default: all 12).
        data_db_path: Path to data-layer DB (for computing v3 features).
            If None, new features will use neutral/zero values.

    Returns:
        List of per-model training results.
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    log.info("Loading snapshots for %s from %s...", coin, db_path)
    rows = load_snapshots_with_labels(db_path, coin)
    log.info("Loaded %d labeled snapshots", len(rows))

    if not rows:
        log.error("No labeled snapshots found for %s", coin)
        return []

    # Enrich with v3 features from data-layer DB
    if data_db_path:
        rows = enrich_with_new_features(rows, coin, data_db_path)
    else:
        log.warning("No --data-db provided. New features will use neutral values.")

    log.info("Building condition targets...")
    rows = build_condition_targets(rows)

    # Filter targets if specified
    active_targets = CONDITION_TARGETS
    if targets:
        active_targets = [t for t in CONDITION_TARGETS if t.name in targets]
        log.info("Training subset: %s", [t.name for t in active_targets])

    results = []

    for target in active_targets:
        log.info("=" * 60)
        log.info("Training: %s — %s", target.name, target.description)
        log.info("=" * 60)

        # Each model gets its own curated feature set (from feature_sets.py)
        result = train_single_condition(rows, target, None, output_path)
        results.append(result)

    # Summary
    log.info("\n" + "=" * 60)
    log.info("TRAINING SUMMARY")
    log.info("=" * 60)
    for r in results:
        if r.get("status") == "success":
            log.info(
                "  %-15s spearman=%.4f  mae=%.4f  centered=%.1f%%  (%d gens, %d samples)",
                r["name"],
                r["avg_spearman"],
                r["avg_mae"],
                r["avg_centered_dir"],
                r["generations"],
                r["training_samples"],
            )
        else:
            log.info("  %-15s %s: %s", r["name"], r.get("status"), r.get("reason", ""))

    return results


def main():
    parser = argparse.ArgumentParser(description="Train condition prediction models")
    parser.add_argument(
        "--db", default="storage/satellite.db",
        help="Path to satellite.db (default: storage/satellite.db)",
    )
    parser.add_argument(
        "--output", default="satellite/artifacts/conditions",
        help="Output directory for model artifacts",
    )
    parser.add_argument(
        "--coin", default="BTC",
        help="Coin to train on (default: BTC)",
    )
    parser.add_argument(
        "--targets", nargs="+", default=None,
        help="Specific targets to train (default: all 12)",
    )
    parser.add_argument(
        "--data-db", default=None,
        help="Path to data-layer DB for v3 features (e.g. storage/hynous-data.db)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Enable verbose logging",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    train_all_conditions(args.db, args.output, args.coin, args.targets, args.data_db)


if __name__ == "__main__":
    main()
