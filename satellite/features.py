"""Feature computation engine — SINGLE SOURCE OF TRUTH.

THIS MODULE IS THE ONLY PLACE WHERE FEATURES ARE COMPUTED.
Training reads from satellite.db (output of this function).
Inference calls this function directly.
Backfill calls this function with historical data.

NEVER duplicate feature computation logic elsewhere.
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
    "liq_magnet_direction",
    "oi_vs_7d_avg_ratio",
    "liq_cascade_active",
    "liq_1h_vs_4h_avg",
    "funding_vs_30d_zscore",
    "hours_to_funding",
    "oi_funding_pressure",
    "cvd_normalized_5m",
    "price_change_5m_pct",
    "volume_vs_1h_avg_ratio",
    "realized_vol_1h",
    "sessions_overlapping",
]

FEATURE_COUNT = len(FEATURE_NAMES)

# Deterministic hash of feature names + order. Checked at inference time
# to ensure model was trained on same feature set.
# IMPORTANT: Must be deterministic across Python sessions and processes.
# Python's hash() is randomized per session (PYTHONHASHSEED). Use SHA-256.
FEATURE_HASH = hashlib.sha256(
    "|".join(FEATURE_NAMES).encode()
).hexdigest()[:16]  # 16-char hex string, collision-safe for <1M feature sets

# Neutral values for imputation when a feature is unavailable.
# These are the values that carry NO signal (model treats as "no information").
NEUTRAL_VALUES: dict[str, float] = {
    "liq_magnet_direction": 0.0,     # balanced liq = no directional pull
    "oi_vs_7d_avg_ratio": 1.0,      # OI at average = neutral
    "liq_cascade_active": 0,         # no cascade
    "liq_1h_vs_4h_avg": 1.0,        # recent liqs at average = neutral
    "funding_vs_30d_zscore": 0.0,    # funding at mean = neutral
    "hours_to_funding": 4.0,         # midpoint of 0-8 range
    "oi_funding_pressure": 0.0,      # no pressure
    "cvd_normalized_5m": 0.0,        # balanced order flow
    "price_change_5m_pct": 0.0,      # no move
    "volume_vs_1h_avg_ratio": 1.0,   # volume at average
    "realized_vol_1h": 0.0,          # no volatility (conservative)
    "sessions_overlapping": 1,        # single session (most common)
}

# Availability columns stored in satellite.db and used as model input features.
# These are the flags that can genuinely be 0 (external data source unavailable).
# NOT included: hours_to_funding_avail, sessions_overlapping_avail
# (always 1 — pure clock math that never fails, carries zero signal for model).
AVAIL_COLUMNS: list[str] = [
    "liq_magnet_avail",
    "oi_7d_avail",
    "liq_cascade_avail",
    "funding_zscore_avail",
    "oi_funding_pressure_avail",
    "cvd_avail",
    "price_change_5m_avail",
    "volume_avail",
    "realized_vol_avail",
]


# ─── Safe Extraction ────────────────────────────────────────────────────────

def safe_float(val, default: float = 0.0) -> float:
    """Convert to float safely. Returns default for None, NaN, inf, or parse errors.

    Args:
        val: Value to convert.
        default: Fallback value.

    Returns:
        Float value, or default if conversion fails or result is non-finite.
    """
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
    """Extract a numeric value from a dict with type checking and range clamping.

    Args:
        data: Source dictionary.
        key: Key to extract.
        default: Fallback if key is missing or value is invalid.
        min_val: Minimum allowed value (clamp if below).
        max_val: Maximum allowed value (clamp if above).

    Returns:
        Extracted float, clamped to [min_val, max_val] if bounds specified.
    """
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
    candles_5m: list[dict] | None = None,   # NEW: [{t, o, h, l, c, v}, ...]
    candles_1m: list[dict] | None = None,   # NEW: [{t, o, h, l, c, v}, ...]
) -> FeatureResult:
    """Compute all 12 structural features for a single coin at a point in time.

    THIS IS THE SINGLE SOURCE OF TRUTH FOR FEATURE COMPUTATION.
    Called by:
      1. satellite.tick() — live 300s collection
      2. SPEC-07 backfill — historical reconstruction from Artemis
      3. SPEC-05 inference — live model prediction

    All three paths produce IDENTICAL feature vectors.

    Args:
        coin: Coin symbol (e.g., "BTC").
        snapshot: MarketSnapshot from daemon (has prices, funding, oi_usd,
            volume_usd).
        data_layer_db: data-layer Database instance (for historical table
            queries).
        heatmap_engine: LiqHeatmapEngine instance (for heatmap data).
        order_flow_engine: OrderFlowEngine instance (for CVD data).
        config: Satellite configuration.
        timestamp: Override timestamp (for backfill). Defaults to time.time().

    Returns:
        FeatureResult with computed features, availability flags, and raw data.
    """
    cfg = config or SatelliteConfig()
    now = timestamp or time.time()
    features: dict[str, float] = {}
    avail: dict[str, int] = {}
    raw_data: dict = {}

    # ─── LIQUIDATION MECHANISM (4 features) ──────────────────────────

    # 1. liq_magnet_direction
    _compute_liq_magnet(coin, features, avail, raw_data, heatmap_engine)

    # 2. oi_vs_7d_avg_ratio
    _compute_oi_ratio(
        coin, features, avail, raw_data, snapshot, data_layer_db, now,
    )

    # 3-4. liq_cascade_active + liq_1h_vs_4h_avg
    _compute_liq_cascade(
        coin, features, avail, raw_data, data_layer_db, now, cfg,
    )

    # ─── FUNDING MECHANISM (3 features) ──────────────────────────────

    # 5. funding_vs_30d_zscore
    _compute_funding_zscore(
        coin, features, avail, raw_data, data_layer_db, now,
    )

    # 6. hours_to_funding
    _compute_hours_to_funding(features, avail, now, cfg)

    # 7. oi_funding_pressure
    _compute_oi_funding_pressure(
        coin, features, avail, raw_data, snapshot, data_layer_db, now,
    )

    # ─── MOMENTUM/CONFIRMATION (3 features) ──────────────────────────

    # 8. cvd_normalized_5m
    _compute_cvd(coin, features, avail, raw_data, order_flow_engine)

    # 9. price_change_5m_pct
    _compute_price_change(
        coin, features, avail, raw_data, snapshot, data_layer_db, now,
        candles_5m=candles_5m,
    )

    # 10. volume_vs_1h_avg_ratio
    _compute_volume_ratio(
        coin, features, avail, raw_data, snapshot, data_layer_db, now,
    )

    # ─── CONTEXT (2 features) ────────────────────────────────────────

    # 11. realized_vol_1h
    _compute_realized_vol(
        coin, features, avail, raw_data, data_layer_db, now,
        candles_1m=candles_1m,
    )

    # 12. sessions_overlapping
    _compute_sessions(features, avail, now)

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
# Each writes to features, avail, and raw_data dicts.


def _compute_liq_magnet(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    heatmap_engine: object | None,
) -> None:
    """Compute liq_magnet_direction from heatmap engine.

    Formula: (short_liq_total - long_liq_total) / total_liq
    Range: [-1, +1]. Positive = more shorts to liquidate = price pulled UP.
    """
    if heatmap_engine is None:
        features["liq_magnet_direction"] = NEUTRAL_VALUES[
            "liq_magnet_direction"
        ]
        avail["liq_magnet_avail"] = 0
        return

    try:
        heatmap = heatmap_engine.get_heatmap(coin)
        if heatmap is None:
            features["liq_magnet_direction"] = NEUTRAL_VALUES[
                "liq_magnet_direction"
            ]
            avail["liq_magnet_avail"] = 0
            return

        raw_data["heatmap"] = heatmap

        summary = heatmap.get("summary", {})
        # Actual keys from liq_heatmap.py _compute_coin_heatmap():
        short_liq = safe_float(summary.get("total_short_liq_usd", 0))
        long_liq = safe_float(summary.get("total_long_liq_usd", 0))
        total = short_liq + long_liq

        if total < 1:
            features["liq_magnet_direction"] = 0.0
        else:
            raw_direction = short_liq - long_liq
            features["liq_magnet_direction"] = max(
                -1.0, min(1.0, raw_direction / total)
            )

        avail["liq_magnet_avail"] = 1

    except Exception:
        log.debug(
            "Failed to compute liq_magnet_direction for %s",
            coin,
            exc_info=True,
        )
        features["liq_magnet_direction"] = NEUTRAL_VALUES[
            "liq_magnet_direction"
        ]
        avail["liq_magnet_avail"] = 0


def _compute_oi_ratio(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
) -> None:
    """Compute oi_vs_7d_avg_ratio: current_oi / rolling_7d_mean_oi.

    Uses oi_history table (SPEC-01) for the 7-day rolling average.
    """
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
            features["oi_vs_7d_avg_ratio"] = NEUTRAL_VALUES[
                "oi_vs_7d_avg_ratio"
            ]
            avail["oi_7d_avail"] = 0
            return

        features["oi_vs_7d_avg_ratio"] = current_oi / avg_oi
        avail["oi_7d_avail"] = 1
        raw_data["oi_current"] = current_oi
        raw_data["oi_7d_avg"] = avg_oi

    except Exception:
        log.debug(
            "Failed to compute oi_vs_7d_avg_ratio for %s",
            coin,
            exc_info=True,
        )
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
    """Compute liq_cascade_active and liq_1h_vs_4h_avg.

    liq_1h_vs_4h_avg = liq_usd_1h * 4 / liq_usd_4h
    liq_cascade_active = 1 if ratio > 2.5 AND total_liq > $500K
    """
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
        log.debug(
            "Failed to compute liq cascade features for %s",
            coin,
            exc_info=True,
        )
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
    """Compute funding_vs_30d_zscore: (current - 30d_mean) / 30d_std.

    NOTE: This feature IS a z-score. During normalization (SPEC-04), it gets
    TYPE C (clip-only, passthrough). Never re-z-score a z-score.
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
            features["funding_vs_30d_zscore"] = NEUTRAL_VALUES[
                "funding_vs_30d_zscore"
            ]
            avail["funding_zscore_avail"] = 0
            return

        current_rate = safe_float(current_row["rate"])

        # Compute 30-day stats in Python (SQLite has no STDEV_POP)
        rows = data_layer_db.conn.execute(
            "SELECT rate FROM funding_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ?",
            (coin, cutoff_30d, now),
        ).fetchall()

        if len(rows) < 10:  # need >= 10 points for meaningful z-score
            features["funding_vs_30d_zscore"] = NEUTRAL_VALUES[
                "funding_vs_30d_zscore"
            ]
            avail["funding_zscore_avail"] = 0
            return

        rates = [safe_float(r["rate"]) for r in rows]
        mean_rate = sum(rates) / len(rates)
        variance = sum((r - mean_rate) ** 2 for r in rates) / len(rates)
        std_rate = math.sqrt(variance) if variance > 0 else 0

        if std_rate < 1e-10:
            features["funding_vs_30d_zscore"] = 0.0
        else:
            features["funding_vs_30d_zscore"] = (
                (current_rate - mean_rate) / std_rate
            )

        avail["funding_zscore_avail"] = 1
        raw_data["funding_current"] = current_rate
        raw_data["funding_30d_mean"] = mean_rate
        raw_data["funding_30d_std"] = std_rate

    except Exception:
        log.debug(
            "Failed to compute funding_vs_30d_zscore for %s",
            coin,
            exc_info=True,
        )
        features["funding_vs_30d_zscore"] = NEUTRAL_VALUES[
            "funding_vs_30d_zscore"
        ]
        avail["funding_zscore_avail"] = 0


def _compute_hours_to_funding(
    features: dict,
    avail: dict,
    now: float,
    cfg: SatelliteConfig,
) -> None:
    """Compute hours_to_funding: time until next 8h funding settlement.

    Hyperliquid funding settles at 00:00 / 08:00 / 16:00 UTC.
    Range: [0, 8]. Near 0 = settlement imminent = directional pressure.
    """
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
    avail["hours_to_funding_avail"] = 1  # always available (clock math)


def _compute_oi_funding_pressure(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
) -> None:
    """Compute oi_funding_pressure: oi_change_1h_pct * funding_rate.

    INTERACTION FEATURE: OI growing AND funding high = dangerously crowded.
    """
    try:
        current_oi = safe_float(getattr(snapshot, "oi_usd", {}).get(coin))
        funding_rate = safe_float(getattr(snapshot, "funding", {}).get(coin))

        if current_oi <= 0:
            features["oi_funding_pressure"] = NEUTRAL_VALUES[
                "oi_funding_pressure"
            ]
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
        log.debug(
            "Failed to compute oi_funding_pressure for %s",
            coin,
            exc_info=True,
        )
        features["oi_funding_pressure"] = NEUTRAL_VALUES[
            "oi_funding_pressure"
        ]
        avail["oi_funding_pressure_avail"] = 0


def _compute_cvd(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    order_flow_engine: object | None,
) -> None:
    """Compute cvd_normalized_5m from OrderFlowEngine.

    Formula: CVD_5m / total_volume_5m. Range: [-1, +1].
    """
    if order_flow_engine is None:
        features["cvd_normalized_5m"] = NEUTRAL_VALUES["cvd_normalized_5m"]
        avail["cvd_avail"] = 0
        return

    try:
        flow = order_flow_engine.get_order_flow(coin)
        windows = flow.get("windows", {})

        # Primary: 5m (300s) window
        w5m = windows.get("5m") or windows.get("300")
        if w5m is None:
            features["cvd_normalized_5m"] = NEUTRAL_VALUES[
                "cvd_normalized_5m"
            ]
            avail["cvd_avail"] = 0
            return

        buy_vol = safe_float(w5m.get("buy_volume_usd"))
        sell_vol = safe_float(w5m.get("sell_volume_usd"))
        total = buy_vol + sell_vol

        if total < 1:
            features["cvd_normalized_5m"] = 0.0
        else:
            cvd = buy_vol - sell_vol
            features["cvd_normalized_5m"] = max(
                -1.0, min(1.0, cvd / total)
            )

        avail["cvd_avail"] = 1
        raw_data["order_flow"] = flow

    except Exception:
        log.debug(
            "Failed to compute cvd for %s", coin, exc_info=True,
        )
        features["cvd_normalized_5m"] = NEUTRAL_VALUES["cvd_normalized_5m"]
        avail["cvd_avail"] = 0


def _compute_price_change(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
    candles_5m: list[dict] | None = None,
) -> None:
    """Compute price_change_5m_pct from 5m candle data.

    Formula: (close_now - close_5m_ago) / close_5m_ago * 100
    Matches Artemis backfill logic (reconstruct.py lines 223-235).

    Args:
        candles_5m: List of 5m candles [{t, o, h, l, c, v}, ...] sorted by t asc.
                    t is Unix milliseconds. Expects at least 2 candles.
    """
    if not candles_5m or len(candles_5m) < 2:
        features["price_change_5m_pct"] = NEUTRAL_VALUES["price_change_5m_pct"]
        avail["price_change_5m_avail"] = 0
        return

    try:
        # Use the last two completed candles (drop the forming one if present).
        # Candles are sorted ascending by timestamp.
        # The last candle may be still forming — use second-to-last as "current"
        # and third-to-last as "previous" to ensure both are complete.
        # If we only have 2 candles, use them directly (best effort).
        if len(candles_5m) >= 3:
            current = candles_5m[-2]   # last completed
            previous = candles_5m[-3]  # 5m before that
        else:
            current = candles_5m[-1]
            previous = candles_5m[-2]

        close_now = float(current.get("c", 0))
        close_prev = float(previous.get("c", 0))

        if close_prev <= 0:
            features["price_change_5m_pct"] = NEUTRAL_VALUES["price_change_5m_pct"]
            avail["price_change_5m_avail"] = 0
            return

        pct = (close_now - close_prev) / close_prev * 100
        features["price_change_5m_pct"] = pct
        avail["price_change_5m_avail"] = 1

    except Exception:
        log.debug("Failed to compute price_change_5m_pct for %s", coin, exc_info=True)
        features["price_change_5m_pct"] = NEUTRAL_VALUES["price_change_5m_pct"]
        avail["price_change_5m_avail"] = 0


def _compute_volume_ratio(
    coin: str,
    features: dict,
    avail: dict,
    raw_data: dict,
    snapshot: object,
    data_layer_db: object,
    now: float,
) -> None:
    """Compute volume_vs_1h_avg_ratio: recent_1h_volume / previous_4h_avg_hourly.

    Both live and backfill write 5m bucket volumes to volume_history.
    This function reads exclusively from that table — never from snapshot.volume_usd
    (which is HL's 24h rolling total, a different metric entirely).
    """
    try:
        cutoff_1h = now - 3600
        cutoff_5h = now - 5 * 3600

        # Current: sum of volume in last hour (twelve 5m buckets)
        row_1h = data_layer_db.conn.execute(
            "SELECT SUM(volume_usd) as total FROM volume_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at <= ?",
            (coin, cutoff_1h, now),
        ).fetchone()
        current_1h = safe_float(row_1h["total"]) if row_1h else 0

        if current_1h <= 0:
            features["volume_vs_1h_avg_ratio"] = NEUTRAL_VALUES[
                "volume_vs_1h_avg_ratio"
            ]
            avail["volume_avail"] = 0
            return

        # Average: hourly volume over previous 4 hours
        row_avg = data_layer_db.conn.execute(
            "SELECT SUM(volume_usd) / 4.0 as avg_hourly FROM volume_history "
            "WHERE coin = ? AND recorded_at >= ? AND recorded_at < ?",
            (coin, cutoff_5h, cutoff_1h),
        ).fetchone()
        avg_hourly = safe_float(row_avg["avg_hourly"]) if row_avg else 0

        if avg_hourly <= 0:
            features["volume_vs_1h_avg_ratio"] = NEUTRAL_VALUES[
                "volume_vs_1h_avg_ratio"
            ]
            avail["volume_avail"] = 0
            return

        features["volume_vs_1h_avg_ratio"] = current_1h / avg_hourly
        avail["volume_avail"] = 1
        raw_data["volume_1h"] = current_1h
        raw_data["volume_avg_hourly"] = avg_hourly

    except Exception:
        log.debug(
            "Failed to compute volume ratio for %s", coin, exc_info=True,
        )
        features["volume_vs_1h_avg_ratio"] = NEUTRAL_VALUES[
            "volume_vs_1h_avg_ratio"
        ]
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
    """Compute realized_vol_1h: stdev of 1m log returns * sqrt(60) * 100.

    Matches Artemis backfill logic (reconstruct.py lines 258-287).

    Args:
        candles_1m: List of 1m candles [{t, o, h, l, c, v}, ...] sorted by t asc.
                    t is Unix milliseconds. Needs at least 10 candles in the last hour.
    """
    if not candles_1m:
        features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
        avail["realized_vol_avail"] = 0
        return

    try:
        # Filter to candles within the last hour
        cutoff_ms = (now - 3600) * 1000
        hour_candles = [c for c in candles_1m if float(c.get("t", 0)) >= cutoff_ms]

        if len(hour_candles) < 10:
            features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
            avail["realized_vol_avail"] = 0
            return

        # Compute log returns
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
        log.debug("Failed to compute realized_vol_1h for %s", coin, exc_info=True)
        features["realized_vol_1h"] = NEUTRAL_VALUES["realized_vol_1h"]
        avail["realized_vol_avail"] = 0


def _compute_sessions(
    features: dict,
    avail: dict,
    now: float,
) -> None:
    """Compute sessions_overlapping: count of active trading sessions.

    Asia: 00-08 UTC, London: 07-16 UTC, US: 13-22 UTC.
    Max = 2 (London+US overlap 13-16 UTC = highest volume window).
    """
    dt = datetime.fromtimestamp(now, tz=timezone.utc)
    hour = dt.hour

    count = 0
    if 0 <= hour < 8:    # Asia
        count += 1
    if 7 <= hour < 16:   # London
        count += 1
    if 13 <= hour < 22:  # US
        count += 1

    features["sessions_overlapping"] = min(count, 2)
    avail["sessions_overlapping_avail"] = 1


# ─── Feature Vector Export ───────────────────────────────────────────────────

def to_feature_vector(result: FeatureResult) -> list[float]:
    """Convert FeatureResult to ordered list matching FEATURE_NAMES.

    Used by model inference. Order MUST match training feature order.
    """
    return [
        result.features.get(name, NEUTRAL_VALUES[name])
        for name in FEATURE_NAMES
    ]


def to_feature_dict(result: FeatureResult) -> dict[str, float]:
    """Convert FeatureResult to dict including availability flags.

    Used for storing to SQLite and for SHAP explanations.
    """
    d = dict(result.features)
    d.update(result.availability)
    return d
