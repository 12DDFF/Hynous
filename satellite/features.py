"""Feature computation engine — SINGLE SOURCE OF TRUTH.

THIS MODULE IS THE ONLY PLACE WHERE FEATURES ARE COMPUTED.
Training reads from satellite.db (output of this function).
Inference calls this function directly.
Backfill calls this function with historical data.

NEVER duplicate feature computation logic elsewhere.

v2 features (14 total):
  KEPT from v1: oi_vs_7d_avg_ratio, liq_cascade_active, liq_1h_vs_4h_avg,
    funding_vs_30d_zscore, hours_to_funding, oi_funding_pressure,
    volume_vs_1h_avg_ratio, realized_vol_1h
  NEW directional: cvd_ratio_30m, cvd_acceleration, price_trend_1h,
    close_position_5m, oi_price_direction, liq_imbalance_1h
  DROPPED: liq_magnet_direction (dead in backfill), cvd_normalized_5m (5m too noisy),
    price_change_5m_pct (5m too noisy), sessions_overlapping (just proxying vol)
"""

import hashlib
import logging
import math
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from satellite import SCHEMA_VERSION
from satellite.config import SatelliteConfig

log = logging.getLogger(__name__)


# ─── Feature Registry ───────────────────────────────────────────────────────

# Canonical feature order (frozen per schema version). Must match model training.
FEATURE_NAMES: list[str] = [
    # Liquidation mechanism (4)
    "oi_vs_7d_avg_ratio",
    "liq_cascade_active",
    "liq_1h_vs_4h_avg",
    "liq_imbalance_1h",
    "liq_total_1h_usd",          # NEW: log10(total liq USD in 1h)
    # Funding mechanism (4)
    "funding_vs_30d_zscore",
    "hours_to_funding",
    "oi_funding_pressure",
    "funding_rate_raw",          # NEW: absolute funding rate
    # OI dynamics (2)
    "oi_change_rate_1h",         # NEW: raw OI % change over 1h
    "oi_price_direction",
    # Volatility (3)
    "realized_vol_1h",
    "realized_vol_4h",           # NEW: stdev of 1m log returns over 4h
    "vol_of_vol",                # NEW: stdev of rolling 15min vols
    # Volume (2)
    "volume_vs_1h_avg_ratio",
    "volume_acceleration",       # NEW: 5m vol / 1h avg vol
    # Order flow / CVD (3)
    "cvd_ratio_30m",
    "cvd_ratio_1h",              # NEW: buy-sell imbalance over 1h
    "cvd_acceleration",
    # Price action (3)
    "price_trend_1h",
    "price_trend_4h",            # NEW: % change over 4h
    "close_position_5m",
    # Microstructure (3)
    "return_autocorrelation",    # NEW: autocorr of 5m log returns over 1h
    "body_ratio_1h",             # NEW: avg |close-open|/(high-low) over 1h
    "upper_wick_ratio_1h",       # NEW: avg (high-max(o,c))/(high-low) over 1h
    # Funding dynamics (1)
    "funding_velocity",          # NEW: current_rate - rate_8h_ago
    # Time encoding (2)
    "hour_sin",                  # NEW: sin(2*pi*hour/24)
    "hour_cos",                  # NEW: cos(2*pi*hour/24)
]

FEATURE_COUNT = len(FEATURE_NAMES)

FEATURE_HASH = hashlib.sha256(
    "|".join(FEATURE_NAMES).encode()
).hexdigest()[:16]

# Neutral values for imputation when a feature is unavailable.
NEUTRAL_VALUES: dict[str, float] = {
    "oi_vs_7d_avg_ratio": 1.0,
    "liq_cascade_active": 0,
    "liq_1h_vs_4h_avg": 1.0,
    "liq_imbalance_1h": 0.0,        # balanced
    "liq_total_1h_usd": 0.0,        # no liquidations (log10 scale)
    "funding_vs_30d_zscore": 0.0,
    "hours_to_funding": 4.0,
    "oi_funding_pressure": 0.0,
    "funding_rate_raw": 0.0,         # neutral funding
    "oi_change_rate_1h": 0.0,        # no OI change
    "oi_price_direction": 0.0,       # no direction
    "realized_vol_1h": 0.0,
    "realized_vol_4h": 0.0,
    "vol_of_vol": 0.0,
    "volume_vs_1h_avg_ratio": 1.0,
    "volume_acceleration": 1.0,      # no acceleration
    "cvd_ratio_30m": 0.0,
    "cvd_ratio_1h": 0.0,
    "cvd_acceleration": 0.0,
    "price_trend_1h": 0.0,
    "price_trend_4h": 0.0,
    "close_position_5m": 0.5,        # mid-range = no signal
    "return_autocorrelation": 0.0,   # no autocorrelation
    "body_ratio_1h": 0.5,            # mid-range body ratio
    "upper_wick_ratio_1h": 0.5,      # mid-range wick ratio
    "funding_velocity": 0.0,         # no funding change
    "hour_sin": 0.0,                 # midnight
    "hour_cos": 1.0,                 # midnight (cos(0)=1)
}

# Availability columns stored in satellite.db and used as model input features.
AVAIL_COLUMNS: list[str] = [
    "oi_7d_avail",
    "liq_cascade_avail",
    "funding_zscore_avail",
    "oi_funding_pressure_avail",
    "volume_avail",
    "realized_vol_avail",
    "cvd_30m_avail",
    "price_trend_1h_avail",
    "close_position_avail",
    "oi_price_dir_avail",
    "liq_imbalance_avail",
]


# ─── Safe Extraction ────────────────────────────────────────────────────────

def safe_float(val, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def safe_extract(
    data: dict,
    key: str,
    default: float = 0.0,
    min_val: float | None = None,
    max_val: float | None = None,
) -> float:
    val = safe_float(data.get(key), default)
    if min_val is not None:
        val = max(val, min_val)
    if max_val is not None:
        val = min(val, max_val)
    return val


# ─── Feature Result ─────────────────────────────────────────────────────────

@dataclass
class FeatureResult:
    """Output of compute_features(). Contains computed features + metadata."""

    snapshot_id: str
    created_at: float
    coin: str
    features: dict[str, float]
    availability: dict[str, int]
    raw_data: dict | None
    schema_version: int


# ─── Core Computation ────────────────────────────────────────────────────────

def compute_features(
    coin: str,
    snapshot: object,
    data_layer_db: object,
    heatmap_engine: object | None = None,
    order_flow_engine: object | None = None,
    config: SatelliteConfig | None = None,
    timestamp: float | None = None,
    candles_5m: list[dict] | None = None,
    candles_1m: list[dict] | None = None,
) -> FeatureResult:
    """Compute all 14 features for a single coin at a point in time.

    THIS IS THE SINGLE SOURCE OF TRUTH FOR FEATURE COMPUTATION.
    Called by:
      1. satellite.tick() — live 300s collection
      2. reconstruct.py backfill — historical reconstruction from Artemis
      3. inference — live model prediction

    All paths produce IDENTICAL feature vectors.
    """
    cfg = config or SatelliteConfig()
    now = timestamp or time.time()
    features: dict[str, float] = {}
    avail: dict[str, int] = {}
    raw_data: dict = {}

    # ─── LIQUIDATION MECHANISM (3 features) ──────────────────────────

    # 1. oi_vs_7d_avg_ratio
    _compute_oi_ratio(
        coin, features, avail, raw_data, snapshot, data_layer_db, now,
    )

    # 2-3. liq_cascade_active + liq_1h_vs_4h_avg
    _compute_liq_cascade(
        coin, features, avail, raw_data, data_layer_db, now, cfg,
    )

    # ─── FUNDING MECHANISM (3 features) ──────────────────────────────

    # 4. funding_vs_30d_zscore
    _compute_funding_zscore(
        coin, features, avail, raw_data, data_layer_db, now,
    )

    # 5. hours_to_funding
    _compute_hours_to_funding(features, avail, now, cfg)

    # 6. oi_funding_pressure
    _compute_oi_funding_pressure(
        coin, features, avail, raw_data, snapshot, data_layer_db, now,
    )

    # ─── MAGNITUDE (2 features) ──────────────────────────────────────

    # 7. volume_vs_1h_avg_ratio
    _compute_volume_ratio(
        coin, features, avail, raw_data, snapshot, data_layer_db, now,
    )

    # 8. realized_vol_1h
    _compute_realized_vol(
        coin, features, avail, raw_data, data_layer_db, now,
        candles_1m=candles_1m,
    )

    # ─── DIRECTIONAL (6 features — NEW) ─────────────────────────────

    # 9-10. cvd_ratio_30m + cvd_acceleration (from trade_flow_history)
    _compute_cvd_directional(
        coin, features, avail, raw_data, data_layer_db, now,
    )

    # 11. price_trend_1h (from candles)
    _compute_price_trend_1h(
        coin, features, avail, raw_data, data_layer_db, now,
        candles_5m=candles_5m,
    )

    # 12. close_position_5m (from candles)
    _compute_close_position(
        coin, features, avail, raw_data, candles_5m=candles_5m,
    )

    # 13. oi_price_direction (from oi_history + candles)
    _compute_oi_price_direction(
        coin, features, avail, raw_data, snapshot, data_layer_db, now,
        candles_5m=candles_5m,
    )

    # 14. liq_imbalance_1h (from liquidation_events)
    _compute_liq_imbalance(
        coin, features, avail, raw_data, data_layer_db, now,
    )

    # ─── NEW FEATURES (v3) ────────────────────────────────────────────

    # 15. liq_total_1h_usd (log10 of total liq USD)
    _compute_liq_total(features, raw_data)

    # 16. funding_rate_raw (absolute funding rate)
    _compute_funding_rate_raw(coin, features, snapshot)

    # 17. oi_change_rate_1h (raw OI % change)
    _compute_oi_change_rate(features, raw_data)

    # 18. realized_vol_4h (4h realized vol from 1m candles)
    _compute_realized_vol_4h(
        coin, features, avail, raw_data, data_layer_db, now,
        candles_1m=candles_1m,
    )

    # 19. vol_of_vol (stdev of rolling 15min vols)
    _compute_vol_of_vol(features, candles_1m=candles_1m)

    # 20. volume_acceleration (5m vol spike vs 1h avg)
    _compute_volume_acceleration(
        coin, features, raw_data, data_layer_db, now,
    )

    # 21. cvd_ratio_1h (1h CVD)
    _compute_cvd_1h(
        coin, features, raw_data, data_layer_db, now,
    )

    # 22. price_trend_4h (4h price change %)
    _compute_price_trend_4h(
        coin, features, avail, raw_data, data_layer_db, now,
        candles_5m=candles_5m,
    )

    # ─── NEW FEATURES (v4) ────────────────────────────────────────────

    # 23. return_autocorrelation (autocorr of 5m log returns over 1h)
    _compute_return_autocorrelation(features, avail, candles_5m=candles_5m, now=now)

    # 24-25. body_ratio_1h + upper_wick_ratio_1h (candle structure)
    _compute_candle_ratios(features, avail, candles_5m=candles_5m, now=now)

    # 26. funding_velocity (rate change over 8h)
    _compute_funding_velocity(coin, features, avail, data_layer_db, now)

    # 27-28. hour_sin + hour_cos (cyclical time encoding)
    _compute_hour_encoding(features, now)

    # ─── Build result ────────────────────────────────────────────────

    snapshot_id = str(uuid.uuid4())

    return FeatureResult(
        snapshot_id=snapshot_id,
        created_at=now,
        coin=coin,
        features=features,
        availability=avail,
        raw_data=raw_data if cfg.store_raw_data else None,
        schema_version=SCHEMA_VERSION,
    )


# ─── Individual Feature Computers ────────────────────────────────────────────


def _compute_oi_ratio(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
) -> None:
    """oi_vs_7d_avg_ratio: current_oi / rolling_7d_mean_oi."""
    current_oi = safe_float(getattr(snapshot, "oi_usd", {}).get(coin))
    if current_oi <= 0:
        features["oi_vs_7d_avg_ratio"] = NEUTRAL_VALUES["oi_vs_7d_avg_ratio"]
        avail["oi_7d_avail"] = 0
        return

    try:
        cutoff = now - 7 * 86400
        row = data_layer_db.conn.execute(
            "SELECT AVG(oi_usd) as avg_oi FROM oi_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ?",
            (coin, cutoff, now),
        ).fetchone()

        avg_oi = safe_float(row["avg_oi"]) if row else 0
        if avg_oi <= 0:
            features["oi_vs_7d_avg_ratio"] = NEUTRAL_VALUES["oi_vs_7d_avg_ratio"]
            avail["oi_7d_avail"] = 0
            return

        features["oi_vs_7d_avg_ratio"] = current_oi / avg_oi
        avail["oi_7d_avail"] = 1
        raw_data["oi_current"] = current_oi
        raw_data["oi_7d_avg"] = avg_oi

    except Exception:
        log.debug("Failed oi_vs_7d_avg_ratio for %s", coin, exc_info=True)
        features["oi_vs_7d_avg_ratio"] = NEUTRAL_VALUES["oi_vs_7d_avg_ratio"]
        avail["oi_7d_avail"] = 0


def _compute_liq_cascade(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
    cfg: SatelliteConfig,
) -> None:
    """liq_cascade_active and liq_1h_vs_4h_avg."""
    try:
        cutoff_1h = now - 3600
        cutoff_4h = now - 4 * 3600

        row_1h = data_layer_db.conn.execute(
            "SELECT COALESCE(SUM(size_usd), 0) as total "
            "FROM liquidation_events "
            "WHERE coin = ? AND occurred_at >= ? AND occurred_at <= ?",
            (coin, cutoff_1h, now),
        ).fetchone()

        row_4h = data_layer_db.conn.execute(
            "SELECT COALESCE(SUM(size_usd), 0) as total "
            "FROM liquidation_events "
            "WHERE coin = ? AND occurred_at >= ? AND occurred_at <= ?",
            (coin, cutoff_4h, now),
        ).fetchone()

        liq_1h = safe_float(row_1h["total"])
        liq_4h = safe_float(row_4h["total"])

        raw_data["liq_1h_usd"] = liq_1h
        raw_data["liq_4h_usd"] = liq_4h

        if liq_4h > 0:
            ratio = (liq_1h * 4) / liq_4h
        else:
            ratio = NEUTRAL_VALUES["liq_1h_vs_4h_avg"]

        features["liq_1h_vs_4h_avg"] = ratio
        avail["liq_cascade_avail"] = 1

        cascade = (
            ratio > cfg.liq_cascade_threshold
            and liq_1h > cfg.liq_cascade_min_usd
        )
        features["liq_cascade_active"] = 1 if cascade else 0

    except Exception:
        log.debug("Failed liq cascade for %s", coin, exc_info=True)
        features["liq_cascade_active"] = NEUTRAL_VALUES["liq_cascade_active"]
        features["liq_1h_vs_4h_avg"] = NEUTRAL_VALUES["liq_1h_vs_4h_avg"]
        avail["liq_cascade_avail"] = 0


def _compute_funding_zscore(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
) -> None:
    """funding_vs_30d_zscore: (current - 30d_mean) / 30d_std.

    TYPE C normalization (clip only, never re-z-score).
    """
    try:
        cutoff_30d = now - 30 * 86400

        current_row = data_layer_db.conn.execute(
            "SELECT rate FROM funding_history "
            "WHERE coin = ? AND recorded_at <= ? "
            "ORDER BY recorded_at DESC LIMIT 1",
            (coin, now),
        ).fetchone()

        if current_row is None:
            features["funding_vs_30d_zscore"] = NEUTRAL_VALUES["funding_vs_30d_zscore"]
            avail["funding_zscore_avail"] = 0
            return

        current_rate = safe_float(current_row["rate"])

        rows = data_layer_db.conn.execute(
            "SELECT rate FROM funding_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ?",
            (coin, cutoff_30d, now),
        ).fetchall()

        if len(rows) < 10:
            features["funding_vs_30d_zscore"] = NEUTRAL_VALUES["funding_vs_30d_zscore"]
            avail["funding_zscore_avail"] = 0
            return

        rates = [safe_float(r["rate"]) for r in rows]
        mean_rate = sum(rates) / len(rates)
        variance = sum((r - mean_rate) ** 2 for r in rates) / len(rates)
        std_rate = math.sqrt(variance) if variance > 0 else 0

        if std_rate < 1e-10:
            features["funding_vs_30d_zscore"] = 0.0
        else:
            features["funding_vs_30d_zscore"] = (current_rate - mean_rate) / std_rate

        avail["funding_zscore_avail"] = 1
        raw_data["funding_current"] = current_rate
        raw_data["funding_30d_mean"] = mean_rate
        raw_data["funding_30d_std"] = std_rate

    except Exception:
        log.debug("Failed funding_vs_30d_zscore for %s", coin, exc_info=True)
        features["funding_vs_30d_zscore"] = NEUTRAL_VALUES["funding_vs_30d_zscore"]
        avail["funding_zscore_avail"] = 0


def _compute_hours_to_funding(
    features: dict,
    avail: dict,
    now: float,
    cfg: SatelliteConfig,
) -> None:
    """hours_to_funding: time until next 8h funding settlement.

    Hyperliquid funding settles at 00:00 / 08:00 / 16:00 UTC.
    """
    try:
        dt = datetime.fromtimestamp(now, tz=timezone.utc)
        current_hour = dt.hour + dt.minute / 60 + dt.second / 3600

        next_settlement_hours = []
        for h in cfg.funding_settlement_hours:
            diff = h - current_hour
            if diff < 0:
                diff += 24
            next_settlement_hours.append(diff)

        hours_to = min(next_settlement_hours)
        features["hours_to_funding"] = round(hours_to, 4)
    except Exception:
        log.debug("Failed hours_to_funding", exc_info=True)
        features["hours_to_funding"] = NEUTRAL_VALUES["hours_to_funding"]


def _compute_oi_funding_pressure(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
) -> None:
    """oi_funding_pressure: oi_change_1h_pct * funding_rate.

    INTERACTION FEATURE: OI growing AND funding high = dangerously crowded.
    """
    try:
        current_oi = safe_float(getattr(snapshot, "oi_usd", {}).get(coin))
        funding_rate = safe_float(getattr(snapshot, "funding", {}).get(coin))

        if current_oi <= 0:
            features["oi_funding_pressure"] = NEUTRAL_VALUES["oi_funding_pressure"]
            avail["oi_funding_pressure_avail"] = 1
            return

        cutoff_1h = now - 3600
        row = data_layer_db.conn.execute(
            "SELECT oi_usd FROM oi_history WHERE coin = ? "
            "AND recorded_at <= ? ORDER BY recorded_at DESC LIMIT 1",
            (coin, cutoff_1h),
        ).fetchone()

        oi_1h_ago = safe_float(row["oi_usd"]) if row else 0

        if oi_1h_ago > 0:
            oi_change_1h_pct = (current_oi - oi_1h_ago) / oi_1h_ago * 100
        else:
            oi_change_1h_pct = 0.0

        features["oi_funding_pressure"] = oi_change_1h_pct * funding_rate
        avail["oi_funding_pressure_avail"] = 1
        raw_data["oi_change_1h_pct"] = oi_change_1h_pct

    except Exception:
        log.debug("Failed oi_funding_pressure for %s", coin, exc_info=True)
        features["oi_funding_pressure"] = NEUTRAL_VALUES["oi_funding_pressure"]
        avail["oi_funding_pressure_avail"] = 0


def _compute_volume_ratio(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
) -> None:
    """volume_vs_1h_avg_ratio: recent_1h_volume / previous_4h_avg_hourly.

    Both live and backfill write 5m bucket volumes to volume_history.
    """
    try:
        cutoff_1h = now - 3600
        cutoff_5h = now - 5 * 3600

        row_1h = data_layer_db.conn.execute(
            "SELECT SUM(volume_usd) as total FROM volume_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ?",
            (coin, cutoff_1h, now),
        ).fetchone()
        current_1h = safe_float(row_1h["total"]) if row_1h else 0

        if current_1h <= 0:
            features["volume_vs_1h_avg_ratio"] = NEUTRAL_VALUES["volume_vs_1h_avg_ratio"]
            avail["volume_avail"] = 0
            return

        row_avg = data_layer_db.conn.execute(
            "SELECT SUM(volume_usd) / 4.0 as avg_hourly FROM volume_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at < ?",
            (coin, cutoff_5h, cutoff_1h),
        ).fetchone()
        avg_hourly = safe_float(row_avg["avg_hourly"]) if row_avg else 0

        if avg_hourly <= 0:
            features["volume_vs_1h_avg_ratio"] = NEUTRAL_VALUES["volume_vs_1h_avg_ratio"]
            avail["volume_avail"] = 0
            return

        features["volume_vs_1h_avg_ratio"] = current_1h / avg_hourly
        avail["volume_avail"] = 1
        raw_data["volume_1h"] = current_1h
        raw_data["volume_avg_hourly"] = avg_hourly

    except Exception:
        log.debug("Failed volume ratio for %s", coin, exc_info=True)
        features["volume_vs_1h_avg_ratio"] = NEUTRAL_VALUES["volume_vs_1h_avg_ratio"]
        avail["volume_avail"] = 0


def _compute_realized_vol(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
    candles_1m: list[dict] | None = None,
) -> None:
    """realized_vol_1h: stdev of 1m log returns * sqrt(60) * 100."""
    if not candles_1m:
        features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
        avail["realized_vol_avail"] = 0
        return

    try:
        cutoff_ms = (now - 3600) * 1000
        hour_candles = [c for c in candles_1m if float(c.get("t", 0)) >= cutoff_ms]

        if len(hour_candles) < 10:
            features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
            avail["realized_vol_avail"] = 0
            return

        returns = []
        for i in range(1, len(hour_candles)):
            prev_close = float(hour_candles[i - 1].get("c", 0))
            curr_close = float(hour_candles[i].get("c", 0))
            if prev_close > 0 and curr_close > 0:
                returns.append(math.log(curr_close / prev_close))

        if len(returns) < 5:
            features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
            avail["realized_vol_avail"] = 0
            return

        mean_ret = sum(returns) / len(returns)
        variance = sum((r - mean_ret) ** 2 for r in returns) / len(returns)
        realized_vol = math.sqrt(variance) * math.sqrt(60) * 100

        features["realized_vol_1h"] = realized_vol
        avail["realized_vol_avail"] = 1

    except Exception:
        log.debug("Failed realized_vol_1h for %s", coin, exc_info=True)
        features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
        avail["realized_vol_avail"] = 0


# ─── NEW DIRECTIONAL FEATURES ───────────────────────────────────────────────


def _compute_cvd_directional(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
) -> None:
    """Compute cvd_ratio_30m and cvd_acceleration from trade_flow_history.

    cvd_ratio_30m = sum(buy - sell) / sum(buy + sell) over 30 minutes.
        Range: [-1, +1]. Positive = net buying pressure.

    cvd_acceleration = cvd_5m_ratio - cvd_30m_ratio.
        Positive = recent buying increasing vs background.
        Negative = recent selling increasing.

    Both read from trade_flow_history which stores 5m buy/sell buckets.
    Historical: populated by Artemis pipeline.
    Live: populated by daemon from TradeStream.
    """
    try:
        cutoff_30m = now - 1800
        cutoff_5m = now - 300

        rows = data_layer_db.conn.execute(
            "SELECT recorded_at, buy_volume_usd, sell_volume_usd "
            "FROM trade_flow_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ?",
            (coin, cutoff_30m, now),
        ).fetchall()

        if not rows:
            features["cvd_ratio_30m"] = NEUTRAL_VALUES["cvd_ratio_30m"]
            features["cvd_acceleration"] = NEUTRAL_VALUES["cvd_acceleration"]
            avail["cvd_30m_avail"] = 0
            return

        # 30m aggregates
        total_buy_30m = 0.0
        total_sell_30m = 0.0
        # 5m aggregates (subset of 30m rows)
        total_buy_5m = 0.0
        total_sell_5m = 0.0

        for r in rows:
            buy = safe_float(r["buy_volume_usd"])
            sell = safe_float(r["sell_volume_usd"])
            recorded = float(r["recorded_at"])

            total_buy_30m += buy
            total_sell_30m += sell

            if recorded >= cutoff_5m:
                total_buy_5m += buy
                total_sell_5m += sell

        total_30m = total_buy_30m + total_sell_30m
        total_5m = total_buy_5m + total_sell_5m

        # CVD ratio 30m
        if total_30m < 1:
            cvd_30m = 0.0
        else:
            cvd_30m = max(-1.0, min(1.0,
                (total_buy_30m - total_sell_30m) / total_30m
            ))

        # CVD ratio 5m (for acceleration)
        if total_5m < 1:
            cvd_5m = 0.0
        else:
            cvd_5m = max(-1.0, min(1.0,
                (total_buy_5m - total_sell_5m) / total_5m
            ))

        features["cvd_ratio_30m"] = cvd_30m
        features["cvd_acceleration"] = max(-2.0, min(2.0, cvd_5m - cvd_30m))
        avail["cvd_30m_avail"] = 1

        raw_data["cvd_30m_buy"] = total_buy_30m
        raw_data["cvd_30m_sell"] = total_sell_30m
        raw_data["cvd_5m_buy"] = total_buy_5m
        raw_data["cvd_5m_sell"] = total_sell_5m

    except Exception:
        log.debug("Failed CVD directional for %s", coin, exc_info=True)
        features["cvd_ratio_30m"] = NEUTRAL_VALUES["cvd_ratio_30m"]
        features["cvd_acceleration"] = NEUTRAL_VALUES["cvd_acceleration"]
        avail["cvd_30m_avail"] = 0


def _compute_price_trend_1h(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
    candles_5m: list[dict] | None = None,
) -> None:
    """price_trend_1h: (close_now - close_1h_ago) / close_1h_ago * 100.

    The most fundamental directional feature. Uses 5m candles.
    Historical: from candles_history (built by Artemis pipeline).
    Live: from candles_5m parameter (HL API or data-layer).
    """
    try:
        now_ms = now * 1000
        target_1h_ms = (now - 3600) * 1000

        # Use candles_5m if provided (both live and backfill pass these)
        if candles_5m and len(candles_5m) >= 2:
            # Find current candle (last completed, i.e. second-to-last)
            past_candles = [c for c in candles_5m if c["t"] <= now_ms]
            if len(past_candles) >= 2:
                close_now = float(past_candles[-2]["c"])  # last completed

                # Find candle closest to 1h ago
                close_1h = None
                for c in past_candles:
                    if c["t"] <= target_1h_ms:
                        close_1h = float(c["c"])
                    else:
                        break

                if close_1h and close_1h > 0 and close_now > 0:
                    pct = (close_now - close_1h) / close_1h * 100
                    features["price_trend_1h"] = pct
                    avail["price_trend_1h_avail"] = 1
                    raw_data["price_now"] = close_now
                    raw_data["price_1h_ago"] = close_1h
                    return

        # Fallback: query candles_history table
        row_now = data_layer_db.conn.execute(
            "SELECT close FROM candles_history "
            "WHERE coin = ? AND interval = '5m' AND open_time <= ? "
            "ORDER BY open_time DESC LIMIT 1",
            (coin, now),
        ).fetchone()

        row_1h = data_layer_db.conn.execute(
            "SELECT close FROM candles_history "
            "WHERE coin = ? AND interval = '5m' AND open_time <= ? "
            "ORDER BY open_time DESC LIMIT 1",
            (coin, now - 3600),
        ).fetchone()

        if row_now and row_1h:
            close_now = safe_float(row_now["close"])
            close_1h = safe_float(row_1h["close"])
            if close_1h > 0 and close_now > 0:
                pct = (close_now - close_1h) / close_1h * 100
                features["price_trend_1h"] = pct
                avail["price_trend_1h_avail"] = 1
                raw_data["price_now"] = close_now
                raw_data["price_1h_ago"] = close_1h
                return

        features["price_trend_1h"] = NEUTRAL_VALUES["price_trend_1h"]
        avail["price_trend_1h_avail"] = 0

    except Exception:
        log.debug("Failed price_trend_1h for %s", coin, exc_info=True)
        features["price_trend_1h"] = NEUTRAL_VALUES["price_trend_1h"]
        avail["price_trend_1h_avail"] = 0


def _compute_close_position(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    candles_5m: list[dict] | None = None,
) -> None:
    """close_position_5m: (close - low) / (high - low) of last completed 5m candle.

    Range: [0, 1]. Near 1 = closed at top (bullish). Near 0 = closed at bottom (bearish).
    Captures intra-bar momentum — where price closed within its range.

    Historical: from candles_5m (built by Artemis pipeline).
    Live: from candles_5m parameter.
    """
    try:
        if not candles_5m or len(candles_5m) < 2:
            features["close_position_5m"] = NEUTRAL_VALUES["close_position_5m"]
            avail["close_position_avail"] = 0
            return

        # Use second-to-last candle (last COMPLETED candle)
        candle = candles_5m[-2]
        high = float(candle.get("h", 0))
        low = float(candle.get("l", 0))
        close = float(candle.get("c", 0))

        range_val = high - low
        if range_val <= 0 or high <= 0:
            features["close_position_5m"] = NEUTRAL_VALUES["close_position_5m"]
            avail["close_position_avail"] = 0
            return

        position = (close - low) / range_val
        features["close_position_5m"] = max(0.0, min(1.0, position))
        avail["close_position_avail"] = 1

    except Exception:
        log.debug("Failed close_position_5m for %s", coin, exc_info=True)
        features["close_position_5m"] = NEUTRAL_VALUES["close_position_5m"]
        avail["close_position_avail"] = 0


def _compute_oi_price_direction(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
    candles_5m: list[dict] | None = None,
) -> None:
    """oi_price_direction: sign(oi_change_1h) * sign(price_change_1h).

    +1 = OI up + price up (new longs, bullish continuation)
    +1 = OI down + price down (long liquidations, bearish)
    -1 = OI up + price down (new shorts opening, bearish pressure)
    -1 = OI down + price up (short squeeze, may reverse)
     0 = no clear signal (one or both near zero)

    Historical & Live: from oi_history + candle data.
    """
    try:
        # Get current OI
        current_oi = safe_float(getattr(snapshot, "oi_usd", {}).get(coin))
        if current_oi <= 0:
            features["oi_price_direction"] = NEUTRAL_VALUES["oi_price_direction"]
            avail["oi_price_dir_avail"] = 0
            return

        # Get OI from 1h ago
        cutoff_1h = now - 3600
        row = data_layer_db.conn.execute(
            "SELECT oi_usd FROM oi_history WHERE coin = ? "
            "AND recorded_at <= ? ORDER BY recorded_at DESC LIMIT 1",
            (coin, cutoff_1h),
        ).fetchone()

        if not row:
            features["oi_price_direction"] = NEUTRAL_VALUES["oi_price_direction"]
            avail["oi_price_dir_avail"] = 0
            return

        oi_1h_ago = safe_float(row["oi_usd"])
        if oi_1h_ago <= 0:
            features["oi_price_direction"] = NEUTRAL_VALUES["oi_price_direction"]
            avail["oi_price_dir_avail"] = 0
            return

        oi_change_pct = (current_oi - oi_1h_ago) / oi_1h_ago * 100

        # Get price change 1h (reuse price_trend_1h if already computed)
        price_change = features.get("price_trend_1h")
        if price_change is None or not avail.get("price_trend_1h_avail"):
            features["oi_price_direction"] = NEUTRAL_VALUES["oi_price_direction"]
            avail["oi_price_dir_avail"] = 0
            return

        # Threshold: ignore tiny moves (< 0.1% OI change or < 0.05% price)
        oi_sign = 0
        if oi_change_pct > 0.1:
            oi_sign = 1
        elif oi_change_pct < -0.1:
            oi_sign = -1

        price_sign = 0
        if price_change > 0.05:
            price_sign = 1
        elif price_change < -0.05:
            price_sign = -1

        features["oi_price_direction"] = float(oi_sign * price_sign)
        avail["oi_price_dir_avail"] = 1
        raw_data["oi_change_1h_for_dir"] = oi_change_pct

    except Exception:
        log.debug("Failed oi_price_direction for %s", coin, exc_info=True)
        features["oi_price_direction"] = NEUTRAL_VALUES["oi_price_direction"]
        avail["oi_price_dir_avail"] = 0


def _compute_liq_imbalance(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
) -> None:
    """liq_imbalance_1h: (short_liq_usd - long_liq_usd) / total.

    Range: [-1, +1]. Positive = shorts squeezed (bullish). Negative = longs liquidated (bearish).
    0 when no liquidations in the window (common, valid signal = calm market).

    Historical & Live: from liquidation_events table with side column.
    """
    try:
        cutoff_1h = now - 3600

        rows = data_layer_db.conn.execute(
            "SELECT side, COALESCE(SUM(size_usd), 0) as total_usd "
            "FROM liquidation_events "
            "WHERE coin = ? AND occurred_at >= ? AND occurred_at <= ? "
            "GROUP BY side",
            (coin, cutoff_1h, now),
        ).fetchall()

        long_liq = 0.0
        short_liq = 0.0
        for r in rows:
            if r["side"] == "long":
                long_liq = safe_float(r["total_usd"])
            elif r["side"] == "short":
                short_liq = safe_float(r["total_usd"])

        total = long_liq + short_liq

        if total < 100:  # less than $100 in liqs = effectively no signal
            features["liq_imbalance_1h"] = 0.0
        else:
            features["liq_imbalance_1h"] = max(-1.0, min(1.0,
                (short_liq - long_liq) / total
            ))

        avail["liq_imbalance_avail"] = 1
        raw_data["liq_long_1h"] = long_liq
        raw_data["liq_short_1h"] = short_liq

    except Exception:
        log.debug("Failed liq_imbalance_1h for %s", coin, exc_info=True)
        features["liq_imbalance_1h"] = NEUTRAL_VALUES["liq_imbalance_1h"]
        avail["liq_imbalance_avail"] = 0


# ─── NEW v3 Feature Computers ────────────────────────────────────────────────


def _compute_liq_total(features: dict, raw_data: dict) -> None:
    """liq_total_1h_usd: log10(total liquidation USD in 1h + 1).

    Derived from raw_data already computed by _compute_liq_cascade.
    log10 scale because liq sizes are heavy-tailed ($100 to $100M).
    """
    liq_1h = raw_data.get("liq_1h_usd", 0.0)
    if liq_1h > 0:
        features["liq_total_1h_usd"] = math.log10(liq_1h + 1)
    else:
        features["liq_total_1h_usd"] = NEUTRAL_VALUES["liq_total_1h_usd"]


def _compute_funding_rate_raw(
    coin: str, features: dict, snapshot: object,
) -> None:
    """funding_rate_raw: absolute current funding rate.

    Complements funding_vs_30d_zscore which normalizes away the magnitude.
    Raw rate tells you absolute squeeze pressure.
    """
    try:
        rate = safe_float(getattr(snapshot, "funding", {}).get(coin))
        features["funding_rate_raw"] = rate
    except Exception:
        features["funding_rate_raw"] = NEUTRAL_VALUES["funding_rate_raw"]


def _compute_oi_change_rate(features: dict, raw_data: dict) -> None:
    """oi_change_rate_1h: raw OI % change over 1h.

    Derived from raw_data already computed by _compute_oi_funding_pressure.
    Raw signal without the funding interaction — pure money flow.
    """
    oi_change = raw_data.get("oi_change_1h_pct", 0.0)
    features["oi_change_rate_1h"] = oi_change


def _compute_realized_vol_4h(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
    candles_1m: list[dict] | None = None,
) -> None:
    """realized_vol_4h: stdev of 1m log returns * sqrt(60) * 100 over 4h.

    Same calculation as realized_vol_1h but 4h window.
    Captures structural volatility regime vs short-term spikes.
    """
    if not candles_1m:
        features["realized_vol_4h"] = NEUTRAL_VALUES["realized_vol_4h"]
        return

    try:
        cutoff_ms = (now - 4 * 3600) * 1000
        candles_4h = [c for c in candles_1m if float(c.get("t", 0)) >= cutoff_ms]

        if len(candles_4h) < 30:
            features["realized_vol_4h"] = NEUTRAL_VALUES["realized_vol_4h"]
            return

        returns = []
        for i in range(1, len(candles_4h)):
            prev_close = float(candles_4h[i - 1].get("c", 0))
            curr_close = float(candles_4h[i].get("c", 0))
            if prev_close > 0 and curr_close > 0:
                returns.append(math.log(curr_close / prev_close))

        if len(returns) < 20:
            features["realized_vol_4h"] = NEUTRAL_VALUES["realized_vol_4h"]
            return

        mean_ret = sum(returns) / len(returns)
        variance = sum((r - mean_ret) ** 2 for r in returns) / len(returns)
        features["realized_vol_4h"] = math.sqrt(variance) * math.sqrt(60) * 100

    except Exception:
        log.debug("Failed realized_vol_4h for %s", coin, exc_info=True)
        features["realized_vol_4h"] = NEUTRAL_VALUES["realized_vol_4h"]


def _compute_vol_of_vol(
    features: dict,
    candles_1m: list[dict] | None = None,
) -> None:
    """vol_of_vol: stdev of rolling 15min realized vols over 1h.

    High vol_of_vol = regime is unstable (transitioning).
    Low vol_of_vol = current vol regime is stable.
    """
    if not candles_1m or len(candles_1m) < 60:
        features["vol_of_vol"] = NEUTRAL_VALUES["vol_of_vol"]
        return

    try:
        # Use last 60 candles (1h of 1m candles)
        recent = candles_1m[-60:]

        # Compute 15min rolling vols (4 windows of 15 candles)
        window_vols = []
        for start in range(0, 60 - 14, 15):
            window = recent[start:start + 15]
            returns = []
            for i in range(1, len(window)):
                prev_c = float(window[i - 1].get("c", 0))
                curr_c = float(window[i].get("c", 0))
                if prev_c > 0 and curr_c > 0:
                    returns.append(math.log(curr_c / prev_c))
            if len(returns) >= 5:
                mean_r = sum(returns) / len(returns)
                var_r = sum((r - mean_r) ** 2 for r in returns) / len(returns)
                window_vols.append(math.sqrt(var_r) * math.sqrt(60) * 100)

        if len(window_vols) < 3:
            features["vol_of_vol"] = NEUTRAL_VALUES["vol_of_vol"]
            return

        mean_vol = sum(window_vols) / len(window_vols)
        var_vol = sum((v - mean_vol) ** 2 for v in window_vols) / len(window_vols)
        features["vol_of_vol"] = math.sqrt(var_vol)

    except Exception:
        features["vol_of_vol"] = NEUTRAL_VALUES["vol_of_vol"]


def _compute_volume_acceleration(
    coin: str,
    features: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
) -> None:
    """volume_acceleration: recent_5m_volume / hourly_avg_5m_volume.

    >1 = sudden volume spike relative to recent hour. Detects surges.
    """
    try:
        cutoff_5m = now - 300
        cutoff_1h = now - 3600

        row_5m = data_layer_db.conn.execute(
            "SELECT SUM(volume_usd) as total FROM volume_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ?",
            (coin, cutoff_5m, now),
        ).fetchone()
        vol_5m = safe_float(row_5m["total"]) if row_5m else 0

        row_1h = data_layer_db.conn.execute(
            "SELECT SUM(volume_usd) / 12.0 as avg_5m FROM volume_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at < ?",
            (coin, cutoff_1h, cutoff_5m),
        ).fetchone()
        avg_5m = safe_float(row_1h["avg_5m"]) if row_1h else 0

        if avg_5m > 0 and vol_5m > 0:
            features["volume_acceleration"] = vol_5m / avg_5m
        else:
            features["volume_acceleration"] = NEUTRAL_VALUES["volume_acceleration"]

    except Exception:
        log.debug("Failed volume_acceleration for %s", coin, exc_info=True)
        features["volume_acceleration"] = NEUTRAL_VALUES["volume_acceleration"]


def _compute_cvd_1h(
    coin: str,
    features: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
) -> None:
    """cvd_ratio_1h: (buy - sell) / (buy + sell) over 1 hour.

    Same as cvd_ratio_30m but longer window — captures sustained pressure.
    """
    try:
        cutoff_1h = now - 3600

        rows = data_layer_db.conn.execute(
            "SELECT buy_volume_usd, sell_volume_usd "
            "FROM trade_flow_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ?",
            (coin, cutoff_1h, now),
        ).fetchall()

        if not rows:
            features["cvd_ratio_1h"] = NEUTRAL_VALUES["cvd_ratio_1h"]
            return

        total_buy = sum(safe_float(r["buy_volume_usd"]) for r in rows)
        total_sell = sum(safe_float(r["sell_volume_usd"]) for r in rows)
        total = total_buy + total_sell

        if total < 1:
            features["cvd_ratio_1h"] = 0.0
        else:
            features["cvd_ratio_1h"] = max(-1.0, min(1.0,
                (total_buy - total_sell) / total
            ))

    except Exception:
        log.debug("Failed cvd_ratio_1h for %s", coin, exc_info=True)
        features["cvd_ratio_1h"] = NEUTRAL_VALUES["cvd_ratio_1h"]


def _compute_price_trend_4h(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    data_layer_db: object,
    now: float,
    candles_5m: list[dict] | None = None,
) -> None:
    """price_trend_4h: (close_now - close_4h_ago) / close_4h_ago * 100.

    Structural trend context. 1h can be a retracement within a 4h trend.
    """
    try:
        now_ms = now * 1000
        target_4h_ms = (now - 4 * 3600) * 1000

        if candles_5m and len(candles_5m) >= 2:
            past_candles = [c for c in candles_5m if c["t"] <= now_ms]
            if len(past_candles) >= 2:
                close_now = float(past_candles[-2]["c"])

                close_4h = None
                for c in past_candles:
                    if c["t"] <= target_4h_ms:
                        close_4h = float(c["c"])
                    else:
                        break

                if close_4h and close_4h > 0 and close_now > 0:
                    features["price_trend_4h"] = (close_now - close_4h) / close_4h * 100
                    return

        # Fallback: candles_history table
        row_now = data_layer_db.conn.execute(
            "SELECT close FROM candles_history "
            "WHERE coin = ? AND interval = '5m' AND open_time <= ? "
            "ORDER BY open_time DESC LIMIT 1",
            (coin, now),
        ).fetchone()

        row_4h = data_layer_db.conn.execute(
            "SELECT close FROM candles_history "
            "WHERE coin = ? AND interval = '5m' AND open_time <= ? "
            "ORDER BY open_time DESC LIMIT 1",
            (coin, now - 4 * 3600),
        ).fetchone()

        if row_now and row_4h:
            close_now = safe_float(row_now["close"])
            close_4h = safe_float(row_4h["close"])
            if close_4h > 0 and close_now > 0:
                features["price_trend_4h"] = (close_now - close_4h) / close_4h * 100
                return

        features["price_trend_4h"] = NEUTRAL_VALUES["price_trend_4h"]

    except Exception:
        log.debug("Failed price_trend_4h for %s", coin, exc_info=True)
        features["price_trend_4h"] = NEUTRAL_VALUES["price_trend_4h"]


# ─── NEW v4 Feature Computers ────────────────────────────────────────────────


def _compute_return_autocorrelation(
    features: dict,
    avail: dict,
    candles_5m: list[dict] | None = None,
    now: float = 0,
) -> None:
    """return_autocorrelation: corr(returns[:-1], returns[1:]) over 1h of 5m candles.

    Positive = trending (momentum). Negative = mean-reverting.
    """
    try:
        if not candles_5m or len(candles_5m) < 13:
            features["return_autocorrelation"] = NEUTRAL_VALUES["return_autocorrelation"]
            avail["return_autocorr_avail"] = 0
            return

        now_ms = now * 1000 if now else float("inf")
        cutoff_ms = (now - 3600) * 1000 if now else 0
        recent = [c for c in candles_5m if c["t"] <= now_ms and c["t"] >= cutoff_ms]

        if len(recent) < 12:
            # Fall back to last 12 candles
            recent = candles_5m[-12:]

        closes = []
        for c in recent:
            cl = float(c.get("c", 0))
            if cl > 0:
                closes.append(cl)

        if len(closes) < 8:
            features["return_autocorrelation"] = NEUTRAL_VALUES["return_autocorrelation"]
            avail["return_autocorr_avail"] = 0
            return

        log_returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]

        if len(log_returns) < 4:
            features["return_autocorrelation"] = NEUTRAL_VALUES["return_autocorrelation"]
            avail["return_autocorr_avail"] = 0
            return

        r1 = log_returns[:-1]
        r2 = log_returns[1:]
        n = len(r1)
        mean1 = sum(r1) / n
        mean2 = sum(r2) / n

        cov = sum((r1[i] - mean1) * (r2[i] - mean2) for i in range(n)) / n
        std1 = math.sqrt(sum((x - mean1) ** 2 for x in r1) / n)
        std2 = math.sqrt(sum((x - mean2) ** 2 for x in r2) / n)

        if std1 < 1e-12 or std2 < 1e-12:
            features["return_autocorrelation"] = 0.0
        else:
            features["return_autocorrelation"] = max(-1.0, min(1.0, cov / (std1 * std2)))
        avail["return_autocorr_avail"] = 1

    except Exception:
        features["return_autocorrelation"] = NEUTRAL_VALUES["return_autocorrelation"]
        avail["return_autocorr_avail"] = 0


def _compute_candle_ratios(
    features: dict,
    avail: dict,
    candles_5m: list[dict] | None = None,
    now: float = 0,
) -> None:
    """body_ratio_1h and upper_wick_ratio_1h from 12 candles (1h of 5m).

    body_ratio = avg |close-open| / (high-low). High = conviction candles.
    upper_wick = avg (high - max(open,close)) / (high-low). High = selling at highs.
    """
    try:
        if not candles_5m or len(candles_5m) < 12:
            features["body_ratio_1h"] = NEUTRAL_VALUES["body_ratio_1h"]
            features["upper_wick_ratio_1h"] = NEUTRAL_VALUES["upper_wick_ratio_1h"]
            avail["body_ratio_avail"] = 0
            avail["upper_wick_avail"] = 0
            return

        now_ms = now * 1000 if now else float("inf")
        cutoff_ms = (now - 3600) * 1000 if now else 0
        recent = [c for c in candles_5m if c["t"] <= now_ms and c["t"] >= cutoff_ms]
        if len(recent) < 12:
            recent = candles_5m[-12:]

        body_ratios = []
        wick_ratios = []
        for c in recent:
            o = float(c.get("o", 0))
            h = float(c.get("h", 0))
            l = float(c.get("l", 0))
            cl = float(c.get("c", 0))
            rng = h - l
            if rng <= 0 or h <= 0:
                continue
            body_ratios.append(abs(cl - o) / rng)
            wick_ratios.append((h - max(o, cl)) / rng)

        if len(body_ratios) < 6:
            features["body_ratio_1h"] = NEUTRAL_VALUES["body_ratio_1h"]
            features["upper_wick_ratio_1h"] = NEUTRAL_VALUES["upper_wick_ratio_1h"]
            avail["body_ratio_avail"] = 0
            avail["upper_wick_avail"] = 0
            return

        features["body_ratio_1h"] = sum(body_ratios) / len(body_ratios)
        features["upper_wick_ratio_1h"] = sum(wick_ratios) / len(wick_ratios)
        avail["body_ratio_avail"] = 1
        avail["upper_wick_avail"] = 1

    except Exception:
        features["body_ratio_1h"] = NEUTRAL_VALUES["body_ratio_1h"]
        features["upper_wick_ratio_1h"] = NEUTRAL_VALUES["upper_wick_ratio_1h"]
        avail["body_ratio_avail"] = 0
        avail["upper_wick_avail"] = 0


def _compute_funding_velocity(
    coin: str,
    features: dict,
    avail: dict,
    data_layer_db: object,
    now: float,
) -> None:
    """funding_velocity: current_rate - rate_8h_ago. Direction of funding movement."""
    try:
        current_row = data_layer_db.conn.execute(
            "SELECT rate FROM funding_history "
            "WHERE coin = ? AND recorded_at <= ? "
            "ORDER BY recorded_at DESC LIMIT 1",
            (coin, now),
        ).fetchone()

        past_row = data_layer_db.conn.execute(
            "SELECT rate FROM funding_history "
            "WHERE coin = ? AND recorded_at <= ? "
            "ORDER BY recorded_at DESC LIMIT 1",
            (coin, now - 8 * 3600),
        ).fetchone()

        if current_row and past_row:
            current_rate = safe_float(current_row["rate"])
            past_rate = safe_float(past_row["rate"])
            features["funding_velocity"] = current_rate - past_rate
            avail["funding_velocity_avail"] = 1
        else:
            features["funding_velocity"] = NEUTRAL_VALUES["funding_velocity"]
            avail["funding_velocity_avail"] = 0

    except Exception:
        features["funding_velocity"] = NEUTRAL_VALUES["funding_velocity"]
        avail["funding_velocity_avail"] = 0


def _compute_hour_encoding(features: dict, now: float) -> None:
    """hour_sin and hour_cos: cyclical time-of-day encoding.

    sin/cos pair encodes the 24h cycle without discontinuity at midnight.
    Always available (pure math from timestamp).
    """
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    hour_frac = dt.hour + dt.minute / 60 + dt.second / 3600
    features["hour_sin"] = math.sin(2 * math.pi * hour_frac / 24)
    features["hour_cos"] = math.cos(2 * math.pi * hour_frac / 24)


# ─── Feature Vector Export ───────────────────────────────────────────────────

def to_feature_vector(result: FeatureResult) -> list[float]:
    """Convert FeatureResult to ordered list matching FEATURE_NAMES."""
    return [
        result.features.get(name, NEUTRAL_VALUES[name])
        for name in FEATURE_NAMES
    ]


def to_feature_dict(result: FeatureResult) -> dict[str, float]:
    """Convert FeatureResult to dict including availability flags."""
    d = dict(result.features)
    d.update(result.availability)
    return d
